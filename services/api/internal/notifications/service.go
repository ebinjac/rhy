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

// CredentialDecryptor decrypts AES-GCM values embedded on EMAIL channel configs.
type CredentialDecryptor interface {
	DecryptStored(ciphertext string) (string, error)
}

type Service struct {
	pool     *pgxpool.Pool
	secrets  SecretResolver
	logger   *slog.Logger
	client   *http.Client
	sendMail func(addr string, a smtp.Auth, from string, to []string, msg []byte) error
}

type delivery struct {
	ID, EventType, ChannelType                                    string
	Config                                                        map[string]any
	AlertID, MonitorID, MonitorName, Severity, Title, Description string
	ApplicationEmails                                             []string
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

type TestEmailInput struct {
	To string `json:"to"`
}

func New(pool *pgxpool.Pool, secrets SecretResolver, logger *slog.Logger) *Service {
	return &Service{
		pool:     pool,
		secrets:  secrets,
		logger:   logger,
		client:   &http.Client{Timeout: 10 * time.Second},
		sendMail: smtp.SendMail,
	}
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

func Enqueue(ctx context.Context, tx pgx.Tx, alertID, eventType string, now time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO notification_deliveries(id,alert_id,channel_id,event_type,status,next_attempt_at,created_at,updated_at) SELECT md5($1::text||id::text||$2)::uuid,$1::uuid,id,$2,'PENDING',$3,$3,$3 FROM configuration_profiles WHERE kind='NOTIFICATION' AND active=TRUE ON CONFLICT(alert_id,channel_id,event_type) DO NOTHING`, alertID, eventType, now)
	return err
}

func EnqueueWithPool(ctx context.Context, pool *pgxpool.Pool, alertID, eventType string, now time.Time) error {
	_, err := pool.Exec(ctx, `INSERT INTO notification_deliveries(id,alert_id,channel_id,event_type,status,next_attempt_at,created_at,updated_at) SELECT md5($1::text||id::text||$2)::uuid,$1::uuid,id,$2,'PENDING',$3,$3,$3 FROM configuration_profiles WHERE kind='NOTIFICATION' AND active=TRUE ON CONFLICT(alert_id,channel_id,event_type) DO NOTHING`, alertID, eventType, now)
	return err
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

func (s *Service) SendTestEmail(ctx context.Context, profileID, to string) error {
	to = strings.TrimSpace(to)
	if to == "" || !strings.Contains(to, "@") {
		return errors.New("a valid destination email is required")
	}
	var profileType string
	var configJSON []byte
	err := s.pool.QueryRow(ctx, `SELECT profile_type,config_json FROM configuration_profiles WHERE id=$1 AND kind='NOTIFICATION' AND active=TRUE`, profileID).Scan(&profileType, &configJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !strings.EqualFold(profileType, "EMAIL") {
		return errors.New("test email is only available for EMAIL notification channels")
	}
	var config map[string]any
	if err = json.Unmarshal(configJSON, &config); err != nil {
		return err
	}
	item := delivery{
		EventType:         "TEST_EMAIL",
		ChannelType:       "EMAIL",
		Config:            config,
		AlertID:           "test",
		MonitorName:       "Rhythm",
		Severity:          "INFO",
		Title:             "Rhythm SMTP test email",
		Description:       "This message confirms Rhythm can deliver alert email through the configured SMTP channel.",
		ApplicationEmails: []string{to},
	}
	// Prefer the explicit test recipient over channel fallbacks.
	item.Config["to"] = []any{}
	return s.email(ctx, item)
}

var ErrNotFound = errors.New("notification channel not found")

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
	s.logger.Error("notification channel delivery failed", "channelType", item.ChannelType, "deliveryId", item.ID, "alertId", item.AlertID, "error", err)
	attempts := item.Attempts + 1
	status := "PENDING"
	if attempts >= 5 {
		status = "FAILED"
	}
	next := now.Add(time.Duration(1<<min(attempts, 6)) * time.Minute)
	safe := truncateError(err)
	_, updateErr := s.pool.Exec(context.WithoutCancel(ctx), `UPDATE notification_deliveries SET status=$2,attempts=$3,last_error=$4,next_attempt_at=$5,updated_at=$6 WHERE id=$1`, item.ID, status, attempts, safe, next, now)
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
	var appEmails []byte
	err = tx.QueryRow(ctx, `
		SELECT d.id::text,d.event_type,d.attempts,p.profile_type,p.config_json,
			a.id::text,COALESCE(a.monitor_id::text,''),
			COALESCE(NULLIF(m.name,''),NULLIF(a.external_monitor_name,''),NULLIF(a.title,''),'Alert'),
			a.severity,a.title,COALESCE(a.description,''),
			COALESCE(app.alert_emails,'[]'::jsonb)
		FROM notification_deliveries d
		JOIN configuration_profiles p ON p.id=d.channel_id
		JOIN alerts a ON a.id=d.alert_id
		LEFT JOIN monitors m ON m.id=a.monitor_id
		LEFT JOIN applications app ON app.id = COALESCE(
			a.application_id,
			(SELECT aml.application_id FROM application_monitor_links aml WHERE aml.monitor_id=a.monitor_id LIMIT 1)
		)
		WHERE d.status='PENDING' AND d.next_attempt_at<=NOW() AND p.active=TRUE
		ORDER BY d.created_at
		FOR UPDATE OF d SKIP LOCKED
		LIMIT 1`).Scan(&item.ID, &item.EventType, &item.Attempts, &item.ChannelType, &config, &item.AlertID, &item.MonitorID, &item.MonitorName, &item.Severity, &item.Title, &item.Description, &appEmails)
	if err != nil {
		return delivery{}, err
	}
	if err = json.Unmarshal(config, &item.Config); err != nil {
		return delivery{}, err
	}
	_ = json.Unmarshal(appEmails, &item.ApplicationEmails)
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
	target, err := s.resolveWebhookURL(ctx, item.Config)
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
	fromName := strings.TrimSpace(fmt.Sprint(item.Config["fromName"]))
	recipients := mergeRecipients(stringSlice(item.Config["to"]), item.ApplicationEmails)
	if host == "" || from == "" {
		return errors.New("email channel requires smtpHost and from")
	}
	if len(recipients) == 0 {
		return errors.New("no recipients: set application alert emails or a fallback to list on the EMAIL channel")
	}
	username, err := s.resolveSMTPCredential(ctx, item.Config, "usernameSecretRef", "encryptedUsername")
	if err != nil {
		return err
	}
	password, err := s.resolveSMTPCredential(ctx, item.Config, "passwordSecretRef", "encryptedPassword")
	if err != nil {
		return err
	}
	var auth smtp.Auth
	if username != "" {
		auth = smtp.PlainAuth("", username, password, host)
	}
	subject := fmt.Sprintf("[%s] %s", item.Severity, item.Title)
	body := fmt.Sprintf("Monitor: %s\r\nEvent: %s\r\n\r\n%s", item.MonitorName, item.EventType, item.Description)
	fromHeader := from
	if fromName != "" {
		fromHeader = fmt.Sprintf("%s <%s>", fromName, from)
	}
	message := []byte("To: " + strings.Join(recipients, ", ") + "\r\nFrom: " + fromHeader + "\r\nSubject: " + subject + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body)
	send := s.sendMail
	if send == nil {
		send = smtp.SendMail
	}
	addr := fmt.Sprintf("%s:%d", host, port)
	errCh := make(chan error, 1)
	go func() {
		errCh <- send(addr, auth, from, recipients, message)
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-errCh:
		return err
	case <-time.After(12 * time.Second):
		return fmt.Errorf("SMTP connection to %s timed out; the server may be unavailable or port %d may be blocked (local Docker should use mailpit:1025)", addr, port)
	}
}

func (s *Service) resolveSMTPCredential(ctx context.Context, config map[string]any, refKey, encryptedKey string) (string, error) {
	if ref := strings.TrimSpace(fmt.Sprint(config[refKey])); ref != "" && ref != "<nil>" {
		if s.secrets == nil {
			return "", errors.New("secret resolver is unavailable")
		}
		return s.secrets.ResolveSecret(ctx, ref)
	}
	if ciphertext := strings.TrimSpace(fmt.Sprint(config[encryptedKey])); ciphertext != "" && ciphertext != "<nil>" {
		decryptor, ok := s.secrets.(CredentialDecryptor)
		if !ok || decryptor == nil {
			return "", errors.New("inline SMTP credentials require secrets encryption support")
		}
		return decryptor.DecryptStored(ciphertext)
	}
	return "", nil
}

func (s *Service) resolveWebhookURL(ctx context.Context, config map[string]any) (string, error) {
	if ref := strings.TrimSpace(fmt.Sprint(config["urlSecretRef"])); ref != "" && ref != "<nil>" {
		if s.secrets == nil {
			return "", errors.New("secret resolver is unavailable")
		}
		return s.secrets.ResolveSecret(ctx, ref)
	}
	if ciphertext := strings.TrimSpace(fmt.Sprint(config["encryptedUrl"])); ciphertext != "" && ciphertext != "<nil>" {
		decryptor, ok := s.secrets.(CredentialDecryptor)
		if !ok || decryptor == nil {
			return "", errors.New("inline webhook URLs require secrets encryption support")
		}
		return decryptor.DecryptStored(ciphertext)
	}
	return "", errors.New("webhook channel is missing a URL")
}

func mergeRecipients(channelTo, applicationEmails []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(channelTo)+len(applicationEmails))
	for _, group := range [][]string{applicationEmails, channelTo} {
		for _, value := range group {
			email := strings.TrimSpace(value)
			if email == "" {
				continue
			}
			key := strings.ToLower(email)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, email)
		}
	}
	return out
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

func truncateError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > 240 {
		message = message[:240]
	}
	return message
}
