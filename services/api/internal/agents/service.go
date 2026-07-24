package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

var ErrNotFound = errors.New("execution agent not found")
var ErrNoCapacity = errors.New("no healthy execution agent matches the requested capabilities")

type Agent struct {
	ID              string         `json:"id"`
	Name            string         `json:"name"`
	GroupID         string         `json:"groupId,omitempty"`
	Version         string         `json:"version"`
	Status          string         `json:"status"`
	Health          string         `json:"health"`
	Tags            []string       `json:"tags"`
	Capabilities    map[string]any `json:"capabilities"`
	MaxConcurrency  int            `json:"maxConcurrency"`
	ActiveRuns      int            `json:"activeRuns"`
	LastHeartbeatAt *time.Time     `json:"lastHeartbeatAt,omitempty"`
	RevokedAt       *time.Time     `json:"revokedAt,omitempty"`
	CreatedAt       time.Time      `json:"createdAt"`
	UpdatedAt       time.Time      `json:"updatedAt"`
}

type RegisterInput struct {
	Name           string         `json:"name"`
	GroupID        string         `json:"groupId"`
	Version        string         `json:"version"`
	Tags           []string       `json:"tags"`
	Capabilities   map[string]any `json:"capabilities"`
	MaxConcurrency int            `json:"maxConcurrency"`
}
type HeartbeatInput struct {
	Version        string         `json:"version"`
	Tags           []string       `json:"tags"`
	Capabilities   map[string]any `json:"capabilities"`
	MaxConcurrency int            `json:"maxConcurrency"`
	ActiveRuns     int            `json:"activeRuns"`
}

type Repository interface {
	List(context.Context) ([]Agent, error)
	Get(context.Context, string) (Agent, error)
	Create(context.Context, Agent) error
	Heartbeat(context.Context, string, HeartbeatInput, time.Time) (Agent, error)
	SetStatus(context.Context, string, string, time.Time) (Agent, error)
	Claim(context.Context, runs.AgentRequirements, time.Time) (Agent, error)
	Release(context.Context, string, time.Time) error
}

type Service struct {
	repository Repository
	now        func() time.Time
}

func New(repository Repository) *Service {
	return &Service{repository: repository, now: func() time.Time { return time.Now().UTC() }}
}
func (s *Service) List(ctx context.Context) ([]Agent, error) {
	items, err := s.repository.List(ctx)
	now := s.now()
	for index := range items {
		items[index].Health = health(items[index], now)
	}
	return items, err
}
func (s *Service) Register(ctx context.Context, input RegisterInput) (Agent, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return Agent{}, errors.New("agent name is required")
	}
	if input.MaxConcurrency == 0 {
		input.MaxConcurrency = 1
	}
	if input.MaxConcurrency < 1 || input.MaxConcurrency > 1000 {
		return Agent{}, errors.New("maxConcurrency must be between 1 and 1000")
	}
	agentID, err := id.NewUUID()
	if err != nil {
		return Agent{}, err
	}
	now := s.now()
	agent := Agent{ID: agentID, Name: input.Name, GroupID: strings.TrimSpace(input.GroupID), Version: strings.TrimSpace(input.Version), Status: "ACTIVE", Health: "HEALTHY", Tags: normalizeTags(input.Tags), Capabilities: input.Capabilities, MaxConcurrency: input.MaxConcurrency, LastHeartbeatAt: &now, CreatedAt: now, UpdatedAt: now}
	if agent.Capabilities == nil {
		agent.Capabilities = map[string]any{}
	}
	return agent, s.repository.Create(ctx, agent)
}
func (s *Service) Heartbeat(ctx context.Context, id string, input HeartbeatInput) (Agent, error) {
	if input.MaxConcurrency < 1 || input.MaxConcurrency > 1000 {
		return Agent{}, errors.New("maxConcurrency must be between 1 and 1000")
	}
	if input.ActiveRuns < 0 || input.ActiveRuns > input.MaxConcurrency {
		return Agent{}, errors.New("activeRuns must be within agent capacity")
	}
	input.Tags = normalizeTags(input.Tags)
	agent, err := s.repository.Heartbeat(ctx, id, input, s.now())
	agent.Health = health(agent, s.now())
	return agent, err
}
func (s *Service) SetStatus(ctx context.Context, id, status string) (Agent, error) {
	switch status {
	case "ACTIVE", "DRAINING", "REVOKED":
	default:
		return Agent{}, errors.New("invalid agent status")
	}
	agent, err := s.repository.SetStatus(ctx, id, status, s.now())
	agent.Health = health(agent, s.now())
	return agent, err
}
func (s *Service) Select(ctx context.Context, requirements runs.AgentRequirements) (string, error) {
	agent, err := s.repository.Claim(ctx, requirements, s.now())
	if err != nil {
		return "", err
	}
	return agent.ID, nil
}
func (s *Service) Release(ctx context.Context, agentID string) error {
	return s.repository.Release(ctx, agentID, s.now())
}
func health(agent Agent, now time.Time) string {
	if agent.Status == "REVOKED" {
		return "REVOKED"
	}
	if agent.LastHeartbeatAt == nil || now.Sub(*agent.LastHeartbeatAt) > 90*time.Second {
		return "OFFLINE"
	}
	if agent.Status == "DRAINING" {
		return "DRAINING"
	}
	if agent.ActiveRuns >= agent.MaxConcurrency {
		return "AT_CAPACITY"
	}
	return "HEALTHY"
}
func normalizeTags(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}

type MemoryRepository struct {
	mu     sync.Mutex
	agents map[string]Agent
}

func NewMemoryRepository() *MemoryRepository { return &MemoryRepository{agents: map[string]Agent{}} }
func (r *MemoryRepository) List(_ context.Context) ([]Agent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Agent{}
	for _, agent := range r.agents {
		out = append(out, agent)
	}
	return out, nil
}
func (r *MemoryRepository) Get(_ context.Context, id string) (Agent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	agent, ok := r.agents[id]
	if !ok {
		return Agent{}, ErrNotFound
	}
	return agent, nil
}
func (r *MemoryRepository) Create(_ context.Context, agent Agent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.agents[agent.ID] = agent
	return nil
}
func (r *MemoryRepository) Heartbeat(_ context.Context, id string, input HeartbeatInput, now time.Time) (Agent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	agent, ok := r.agents[id]
	if !ok {
		return Agent{}, ErrNotFound
	}
	if agent.Status == "REVOKED" {
		return Agent{}, errors.New("revoked agents cannot heartbeat")
	}
	agent.Version, agent.Tags, agent.Capabilities, agent.MaxConcurrency, agent.ActiveRuns, agent.LastHeartbeatAt, agent.UpdatedAt = input.Version, input.Tags, input.Capabilities, input.MaxConcurrency, input.ActiveRuns, &now, now
	r.agents[id] = agent
	return agent, nil
}
func (r *MemoryRepository) SetStatus(_ context.Context, id, status string, now time.Time) (Agent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	agent, ok := r.agents[id]
	if !ok {
		return Agent{}, ErrNotFound
	}
	agent.Status, agent.UpdatedAt = status, now
	if status == "REVOKED" {
		agent.RevokedAt = &now
	}
	r.agents[id] = agent
	return agent, nil
}
func (r *MemoryRepository) Claim(_ context.Context, requirements runs.AgentRequirements, now time.Time) (Agent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var selected *Agent
	for id, agent := range r.agents {
		if !matches(agent, requirements, now) {
			continue
		}
		if selected == nil || float64(agent.ActiveRuns)/float64(agent.MaxConcurrency) < float64(selected.ActiveRuns)/float64(selected.MaxConcurrency) {
			copy := agent
			copy.ID = id
			selected = &copy
		}
	}
	if selected == nil {
		return Agent{}, ErrNoCapacity
	}
	selected.ActiveRuns++
	selected.UpdatedAt = now
	r.agents[selected.ID] = *selected
	return *selected, nil
}
func (r *MemoryRepository) Release(_ context.Context, id string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	agent, ok := r.agents[id]
	if !ok {
		return ErrNotFound
	}
	agent.ActiveRuns = max(0, agent.ActiveRuns-1)
	agent.UpdatedAt = now
	r.agents[id] = agent
	return nil
}
func matches(agent Agent, requirements runs.AgentRequirements, now time.Time) bool {
	if agent.Status != "ACTIVE" || agent.LastHeartbeatAt == nil || now.Sub(*agent.LastHeartbeatAt) > 90*time.Second || agent.ActiveRuns >= agent.MaxConcurrency {
		return false
	}
	if requirements.AgentID != "" && requirements.AgentID != agent.ID {
		return false
	}
	if requirements.GroupID != "" && requirements.GroupID != agent.GroupID {
		return false
	}
	tags := map[string]bool{}
	for _, tag := range agent.Tags {
		tags[tag] = true
	}
	for _, tag := range requirements.RequiredTags {
		if !tags[strings.ToLower(tag)] {
			return false
		}
	}
	for _, capability := range requirements.RequiredCapabilities {
		value, ok := agent.Capabilities[capability]
		if !ok || value == false {
			return false
		}
	}
	return true
}

type PostgresRepository struct{ pool *pgxpool.Pool }

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

type scanner interface{ Scan(...any) error }

func scanAgent(row scanner) (Agent, error) {
	var agent Agent
	var tags, capabilities []byte
	err := row.Scan(&agent.ID, &agent.Name, &agent.GroupID, &agent.Version, &agent.Status, &tags, &capabilities, &agent.MaxConcurrency, &agent.ActiveRuns, &agent.LastHeartbeatAt, &agent.RevokedAt, &agent.CreatedAt, &agent.UpdatedAt)
	if err == nil {
		err = json.Unmarshal(tags, &agent.Tags)
	}
	if err == nil {
		err = json.Unmarshal(capabilities, &agent.Capabilities)
	}
	return agent, err
}

const columns = `id::text,name,COALESCE(agent_group_id,''),version,status,tags,capabilities_json,max_concurrency,active_runs,last_heartbeat_at,revoked_at,created_at,updated_at`

func (r *PostgresRepository) List(ctx context.Context) ([]Agent, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+columns+` FROM agents ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Agent{}
	for rows.Next() {
		agent, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, agent)
	}
	return out, rows.Err()
}
func (r *PostgresRepository) Get(ctx context.Context, id string) (Agent, error) {
	agent, err := scanAgent(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM agents WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Agent{}, ErrNotFound
	}
	return agent, err
}
func (r *PostgresRepository) Create(ctx context.Context, agent Agent) error {
	tags, _ := json.Marshal(agent.Tags)
	capabilities, _ := json.Marshal(agent.Capabilities)
	_, err := r.pool.Exec(ctx, `INSERT INTO agents(id,name,agent_group_id,version,status,tags,capabilities_json,max_concurrency,active_runs,last_heartbeat_at,created_at,updated_at)VALUES($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,$11,$12)`, agent.ID, agent.Name, agent.GroupID, agent.Version, agent.Status, tags, capabilities, agent.MaxConcurrency, agent.ActiveRuns, agent.LastHeartbeatAt, agent.CreatedAt, agent.UpdatedAt)
	return err
}
func (r *PostgresRepository) Heartbeat(ctx context.Context, id string, input HeartbeatInput, now time.Time) (Agent, error) {
	tags, _ := json.Marshal(input.Tags)
	capabilities, _ := json.Marshal(input.Capabilities)
	tag, err := r.pool.Exec(ctx, `UPDATE agents SET version=$2,tags=$3,capabilities_json=$4,max_concurrency=$5,active_runs=$6,last_heartbeat_at=$7,updated_at=$7 WHERE id=$1 AND status<>'REVOKED'`, id, input.Version, tags, capabilities, input.MaxConcurrency, input.ActiveRuns, now)
	if err != nil {
		return Agent{}, err
	}
	if tag.RowsAffected() == 0 {
		return Agent{}, ErrNotFound
	}
	return r.Get(ctx, id)
}
func (r *PostgresRepository) SetStatus(ctx context.Context, id, status string, now time.Time) (Agent, error) {
	tag, err := r.pool.Exec(ctx, `UPDATE agents SET status=$2,revoked_at=CASE WHEN $2='REVOKED' THEN $3 ELSE revoked_at END,updated_at=$3 WHERE id=$1`, id, status, now)
	if err != nil {
		return Agent{}, err
	}
	if tag.RowsAffected() == 0 {
		return Agent{}, ErrNotFound
	}
	return r.Get(ctx, id)
}
func (r *PostgresRepository) Claim(ctx context.Context, requirements runs.AgentRequirements, now time.Time) (Agent, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Agent{}, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	rows, err := tx.Query(ctx, `SELECT `+columns+` FROM agents WHERE status='ACTIVE' AND last_heartbeat_at>$1 AND active_runs<max_concurrency ORDER BY (active_runs::float/max_concurrency),last_heartbeat_at DESC FOR UPDATE SKIP LOCKED`, now.Add(-90*time.Second))
	if err != nil {
		return Agent{}, err
	}
	var selected Agent
	for rows.Next() {
		candidate, scanErr := scanAgent(rows)
		if scanErr != nil {
			rows.Close()
			return Agent{}, scanErr
		}
		if matches(candidate, requirements, now) {
			selected = candidate
			break
		}
	}
	rows.Close()
	if selected.ID == "" {
		return Agent{}, ErrNoCapacity
	}
	if _, err = tx.Exec(ctx, `UPDATE agents SET active_runs=active_runs+1,updated_at=$2 WHERE id=$1`, selected.ID, now); err != nil {
		return Agent{}, err
	}
	selected.ActiveRuns++
	if err = tx.Commit(ctx); err != nil {
		return Agent{}, err
	}
	return selected, nil
}
func (r *PostgresRepository) Release(ctx context.Context, id string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `UPDATE agents SET active_runs=GREATEST(0,active_runs-1),updated_at=$2 WHERE id=$1`, id, now)
	if err == nil && tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: %s", ErrNotFound, id)
	}
	return err
}
