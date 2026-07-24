package audit

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/id"
)

type Event struct {
	ID            string    `json:"id"`
	ActorID       string    `json:"actorId,omitempty"`
	Action        string    `json:"action"`
	ResourceType  string    `json:"resourceType"`
	ResourceID    string    `json:"resourceId"`
	Outcome       string    `json:"outcome"`
	CorrelationID string    `json:"correlationId,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}
type Service struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }
func (s *Service) Record(ctx context.Context, event Event) error {
	event.ID, _ = id.NewUUID()
	_, err := s.pool.Exec(ctx, `INSERT INTO audit_events(id,actor_id,action,resource_type,resource_id,outcome,correlation_id,created_at) VALUES($1,NULLIF($2,''),$3,$4,$5,$6,NULLIF($7,''),NOW())`, event.ID, event.ActorID, event.Action, event.ResourceType, event.ResourceID, event.Outcome, event.CorrelationID)
	return err
}
func (s *Service) List(ctx context.Context, limit int) ([]Event, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text,COALESCE(actor_id,''),action,resource_type,resource_id,outcome,COALESCE(correlation_id,''),created_at FROM audit_events ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Event, 0)
	for rows.Next() {
		var event Event
		if err := rows.Scan(&event.ID, &event.ActorID, &event.Action, &event.ResourceType, &event.ResourceID, &event.Outcome, &event.CorrelationID, &event.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, event)
	}
	return items, rows.Err()
}
