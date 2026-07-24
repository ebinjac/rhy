package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/smtp"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SecretResolver interface {
	ResolveSecret(context.Context, string) (string, error)
}
type Service struct {
	pool    *pgxpool.Pool
	secrets SecretResolver
	logger  *slog.Logger
	client  *http.Client
}
type delivery struct {
	ID, EventType, ChannelType                                    string
	Config                                                        map[string]any
	AlertID, MonitorID, MonitorName, Severity, Title, Description string
	Attempts                                                      int
}
type Delivery struct {
	ID          string     `json:"id"`
	EventType   string     `json:"eventType"`
	Status      string     `json:"status"`
	ChannelName string     `json:"channelName"`
	ChannelType string     `json:"channelType"`
	AlertID     string     `json:"alertId"`
	Attempts    int        `json:"attempts"`
	LastError   string     `json:"lastError,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	SentAt      *time.Time `json:"sentAt,omitempty"`
}

func New(pool *pgxpool.Pool, secrets SecretResolver, logger *slog.Logger) *Service {
	return &Service{pool: pool, secrets: secrets, logger: logger, client: &http.Client{Timeout: 10 * time.Second}}
}
func (s *Service) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			if err := s.processOne(ctx); err != nil && !errors.Is(err, context.Canceled) {
				s.logger.Error("notification delivery", "error", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}
func (s *Service) List(ctx context.Context) ([]Delivery, error) {
	rows, err := s.pool.Query(ctx, `SELECT d.id::text,d.event_type,d.status,p.name,p.profile_type,d.alert_id::text,d.attempts,COALESCE(d.last_error,''),d.created_at,d.sent_at FROM notification_deliveries d JOIN configuration_profiles p ON p.id=d.channel_id ORDER BY d.created_at DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Delivery{}
	for rows.Next() {
		var item Delivery
		if err := rows.Scan(&item.ID, &item.EventType, &item.Status, &item.ChannelName, &item.ChannelType, &item.AlertID, &item.Attempts, &item.LastError, &item.CreatedAt, &item.SentAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s *Service) processOne(ctx context.Context) error {
	item, err := s.claim(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	err = s.deliver(ctx, item)
	now := time.Now().UTC()
	if err == nil {
		_, updateErr := s.pool.Exec(context.WithoutCancel(ctx), `UPDATE notification_deliveries SET status='SENT',sent_at=$2,last_error=NULL,updated_at=$2 WHERE id=$1`, item.ID, now)
		return updateErr
	}
	attempts := item.Attempts + 1
	status := "PENDING"
	if attempts >= 5 {
		status = "FAILED"
	}
	next := now.Add(time.Duration(1<<min(attempts, 6)) * time.Minute)
	_, updateErr := s.pool.Exec(context.WithoutCancel(ctx), `UPDATE notification_deliveries SET status=$2,attempts=$3,last_error=$4,next_attempt_at=$5,updated_at=$6 WHERE id=$1`, item.ID, status, attempts, "Delivery failed; inspect channel configuration and connectivity.", next, now)
	if updateErr != nil {
		return updateErr
	}
	return fmt.Errorf("channel %s delivery failed: %w", item.ChannelType, err)
}
func (s *Service) claim(ctx context.Context) (delivery, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return delivery{}, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var item delivery
	var config []byte
	err = tx.QueryRow(ctx, `SELECT d.id::text,d.event_type,d.attempts,p.profile_type,p.config_json,a.id::text,a.monitor_id::text,m.name,a.severity,a.title,COALESCE(a.description,'') FROM notification_deliveries d JOIN configuration_profiles p ON p.id=d.channel_id JOIN alerts a ON a.id=d.alert_id JOIN monitors m ON m.id=a.monitor_id WHERE d.status='PENDING' AND d.next_attempt_at<=NOW() AND p.active=TRUE ORDER BY d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`).Scan(&item.ID, &item.EventType, &item.Attempts, &item.ChannelType, &config, &item.AlertID, &item.MonitorID, &item.MonitorName, &item.Severity, &item.Title, &item.Description)
	if err != nil {
		return delivery{}, err
	}
	if err = json.Unmarshal(config, &item.Config); err != nil {
		return delivery{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE notification_deliveries SET status='SENDING',updated_at=NOW() WHERE id=$1`, item.ID); err != nil {
		return delivery{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return delivery{}, err
	}
	return item, nil
}
func (s *Service) deliver(ctx context.Context, item delivery) error {
	switch strings.ToUpper(item.ChannelType) {
	case "WEBHOOK", "SLACK":
		return s.webhook(ctx, item)
	case "EMAIL":
		return s.email(ctx, item)
	default:
		return fmt.Errorf("unsupported notification channel type")
	}
}
func (s *Service) webhook(ctx context.Context, item delivery) error {
	reference := fmt.Sprint(item.Config["urlSecretRef"])
	target, err := s.secrets.ResolveSecret(ctx, reference)
	if err != nil {
		return err
	}
	parsed, err := url.Parse(target)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return errors.New("notification endpoint is invalid")
	}
	payload := map[string]any{"event": item.EventType, "alertId": item.AlertID, "monitorId": item.MonitorID, "monitorName": item.MonitorName, "severity": item.Severity, "title": item.Title, "description": item.Description}
	if strings.EqualFold(item.ChannelType, "SLACK") {
		payload = map[string]any{"text": fmt.Sprintf("[%s] %s — %s (%s)", item.Severity, item.Title, item.MonitorName, item.EventType)}
	}
	encoded, _ := json.Marshal(payload)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("notification endpoint returned status %d", response.StatusCode)
	}
	return nil
}
func (s *Service) email(ctx context.Context, item delivery) error {
	host := strings.TrimSpace(fmt.Sprint(item.Config["smtpHost"]))
	port, _ := strconv.Atoi(fmt.Sprint(item.Config["smtpPort"]))
	if port == 0 {
		port = 587
	}
	from := strings.TrimSpace(fmt.Sprint(item.Config["from"]))
	recipients := stringSlice(item.Config["to"])
	if host == "" || from == "" || len(recipients) == 0 {
		return errors.New("email channel requires smtpHost, from, and to")
	}
	username, password := "", ""
	var err error
	if ref := fmt.Sprint(item.Config["usernameSecretRef"]); ref != "" && ref != "<nil>" {
		username, err = s.secrets.ResolveSecret(ctx, ref)
		if err != nil {
			return err
		}
	}
	if ref := fmt.Sprint(item.Config["passwordSecretRef"]); ref != "" && ref != "<nil>" {
		password, err = s.secrets.ResolveSecret(ctx, ref)
		if err != nil {
			return err
		}
	}
	var auth smtp.Auth
	if username != "" {
		auth = smtp.PlainAuth("", username, password, host)
	}
	subject := fmt.Sprintf("[%s] %s", item.Severity, item.Title)
	body := fmt.Sprintf("Monitor: %s\r\nEvent: %s\r\n\r\n%s", item.MonitorName, item.EventType, item.Description)
	message := []byte("To: " + strings.Join(recipients, ",") + "\r\nFrom: " + from + "\r\nSubject: " + subject + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body)
	return smtp.SendMail(fmt.Sprintf("%s:%d", host, port), auth, from, recipients, message)
}
func stringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]string); ok {
			return typed
		}
		return nil
	}
	out := []string{}
	for _, entry := range raw {
		if text := strings.TrimSpace(fmt.Sprint(entry)); text != "" {
			out = append(out, text)
		}
	}
	return out
}
