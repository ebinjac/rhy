package monitors

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"
)

var (
	ErrNotFound           = errors.New("monitor not found")
	ErrConflict           = errors.New("monitor conflicts with an existing resource")
	ErrPreconditionFailed = errors.New("monitor was changed by another request")
)

type Repository interface {
	List(context.Context) ([]Monitor, error)
	Get(context.Context, string) (Monitor, error)
	Create(context.Context, Monitor, Revision) (Monitor, error)
	Update(context.Context, Monitor, time.Time) (Monitor, error)
	UpdateDraft(context.Context, string, map[string]any, string, time.Time) (Monitor, Revision, error)
	Publish(context.Context, string, Revision, Revision, string, time.Time) (Monitor, Revision, error)
	SetState(context.Context, string, State, bool, string, time.Time) (Monitor, error)
	SoftDelete(context.Context, string, string, time.Time) error
	PermanentDelete(context.Context, []string) (int64, error)
	ListRevisions(context.Context, string) ([]Revision, error)
	GetRevision(context.Context, string, string) (Revision, error)
}

type MemoryRepository struct {
	mu        sync.RWMutex
	monitors  map[string]Monitor
	revisions map[string][]Revision
}

func NewMemoryRepository(seed []Monitor) *MemoryRepository {
	repository := &MemoryRepository{monitors: make(map[string]Monitor), revisions: make(map[string][]Revision)}
	for _, monitor := range seed {
		repository.monitors[monitor.ID] = monitor
	}
	return repository
}

func (r *MemoryRepository) List(_ context.Context) ([]Monitor, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]Monitor, 0, len(r.monitors))
	for _, monitor := range r.monitors {
		items = append(items, monitor)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items, nil
}

func (r *MemoryRepository) Get(_ context.Context, monitorID string) (Monitor, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	monitor, ok := r.monitors[monitorID]
	if !ok {
		return Monitor{}, ErrNotFound
	}
	return monitor, nil
}

func (r *MemoryRepository) Create(_ context.Context, monitor Monitor, revision Revision) (Monitor, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.monitors {
		if existing.Slug == monitor.Slug {
			return Monitor{}, ErrConflict
		}
	}
	r.monitors[monitor.ID] = monitor
	r.revisions[monitor.ID] = []Revision{revision}
	return monitor, nil
}

func (r *MemoryRepository) Update(_ context.Context, monitor Monitor, expectedUpdatedAt time.Time) (Monitor, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	existing, ok := r.monitors[monitor.ID]
	if !ok {
		return Monitor{}, ErrNotFound
	}
	if !existing.UpdatedAt.Equal(expectedUpdatedAt) {
		return Monitor{}, ErrPreconditionFailed
	}
	for id, candidate := range r.monitors {
		if id != monitor.ID && candidate.Slug == monitor.Slug {
			return Monitor{}, ErrConflict
		}
	}
	r.monitors[monitor.ID] = monitor
	return monitor, nil
}

func (r *MemoryRepository) UpdateDraft(_ context.Context, monitorID string, definition map[string]any, actorID string, updatedAt time.Time) (Monitor, Revision, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	monitor, ok := r.monitors[monitorID]
	if !ok {
		return Monitor{}, Revision{}, ErrNotFound
	}
	revisions := r.revisions[monitorID]
	for index := range revisions {
		if revisions[index].ID == monitor.CurrentDraftRevisionID && revisions[index].Status == RevisionDraft {
			revisions[index].Definition = definition
			monitor.UpdatedBy, monitor.UpdatedAt = actorID, updatedAt
			r.revisions[monitorID], r.monitors[monitorID] = revisions, monitor
			return monitor, revisions[index], nil
		}
	}
	return Monitor{}, Revision{}, ErrConflict
}

func (r *MemoryRepository) Publish(_ context.Context, monitorID string, published Revision, nextDraft Revision, actorID string, updatedAt time.Time) (Monitor, Revision, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	monitor, ok := r.monitors[monitorID]
	if !ok {
		return Monitor{}, Revision{}, ErrNotFound
	}
	revisions := r.revisions[monitorID]
	found := false
	for index := range revisions {
		if revisions[index].ID == monitor.CurrentDraftRevisionID && revisions[index].Status == RevisionDraft {
			revisions[index] = published
			found = true
			break
		}
	}
	if !found {
		return Monitor{}, Revision{}, ErrConflict
	}
	revisions = append(revisions, nextDraft)
	monitor.CurrentDraftRevisionID, monitor.LatestPublishedRevisionID = nextDraft.ID, published.ID
	if !monitor.Enabled {
		monitor.State = StatePublished
	}
	monitor.UpdatedBy, monitor.UpdatedAt = actorID, updatedAt
	r.revisions[monitorID], r.monitors[monitorID] = revisions, monitor
	return monitor, published, nil
}

func (r *MemoryRepository) SetState(_ context.Context, monitorID string, state State, enabled bool, actorID string, updatedAt time.Time) (Monitor, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	monitor, ok := r.monitors[monitorID]
	if !ok {
		return Monitor{}, ErrNotFound
	}
	monitor.State, monitor.Enabled, monitor.UpdatedBy, monitor.UpdatedAt = state, enabled, actorID, updatedAt
	r.monitors[monitorID] = monitor
	return monitor, nil
}

func (r *MemoryRepository) SoftDelete(_ context.Context, monitorID, _ string, _ time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.monitors[monitorID]; !ok {
		return ErrNotFound
	}
	delete(r.monitors, monitorID)
	return nil
}

func (r *MemoryRepository) PermanentDelete(_ context.Context, monitorIDs []string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, monitorID := range monitorIDs {
		if _, ok := r.monitors[monitorID]; !ok {
			return 0, ErrNotFound
		}
	}
	for _, monitorID := range monitorIDs {
		delete(r.monitors, monitorID)
		delete(r.revisions, monitorID)
	}
	return int64(len(monitorIDs)), nil
}

func (r *MemoryRepository) ListRevisions(_ context.Context, monitorID string) ([]Revision, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.monitors[monitorID]; !ok {
		return nil, ErrNotFound
	}
	items := append([]Revision(nil), r.revisions[monitorID]...)
	sort.Slice(items, func(i, j int) bool { return items[i].RevisionNumber > items[j].RevisionNumber })
	return items, nil
}

func (r *MemoryRepository) GetRevision(_ context.Context, monitorID, revisionID string) (Revision, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.monitors[monitorID]; !ok {
		return Revision{}, ErrNotFound
	}
	for _, revision := range r.revisions[monitorID] {
		if revision.ID == revisionID {
			return revision, nil
		}
	}
	return Revision{}, ErrNotFound
}
