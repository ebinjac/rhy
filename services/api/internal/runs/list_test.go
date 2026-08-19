package runs

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/monitors"
)

func TestListPagePaginatesBeyondTheLegacyFiftyCap(t *testing.T) {
	t.Parallel()
	monitorID := "monitor-history"
	monitorRepository := monitors.NewMemoryRepository([]monitors.Monitor{{
		ID: monitorID, Name: "History monitor", Slug: "history-monitor",
	}})
	runRepository := NewMemoryRepository()
	service := NewService(monitors.NewService(monitorRepository), runRepository, NewHTTPExecutor(true))
	now := time.Date(2026, time.August, 19, 12, 0, 0, 0, time.UTC)
	for index := 0; index < 75; index++ {
		if err := runRepository.Save(context.Background(), Run{
			ID:          fmt.Sprintf("run-%02d", index),
			MonitorID:   monitorID,
			Status:      StatusSuccess,
			TriggerType: "SCHEDULE",
			CreatedAt:   now.Add(-time.Duration(index) * time.Minute),
		}); err != nil {
			t.Fatal(err)
		}
	}

	first, err := service.ListPage(context.Background(), monitorID, PageQuery{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if first.Total != 75 || !first.HasMore || len(first.Items) != 50 {
		t.Fatalf("unexpected first page: total=%d hasMore=%t count=%d", first.Total, first.HasMore, len(first.Items))
	}
	if first.Items[0].ID != "run-00" || first.Items[49].ID != "run-49" {
		t.Fatalf("unexpected first page bounds: first=%s last=%s", first.Items[0].ID, first.Items[49].ID)
	}

	second, err := service.ListPage(context.Background(), monitorID, PageQuery{
		Limit: 50, AfterCreatedAt: first.Items[49].CreatedAt, AfterID: first.Items[49].ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.Total != 75 || second.HasMore || len(second.Items) != 25 {
		t.Fatalf("unexpected second page: total=%d hasMore=%t count=%d", second.Total, second.HasMore, len(second.Items))
	}
	if second.Items[0].ID != "run-50" || second.Items[24].ID != "run-74" {
		t.Fatalf("unexpected second page bounds: first=%s last=%s", second.Items[0].ID, second.Items[24].ID)
	}
}

func TestListPageFiltersBySinceAndStatus(t *testing.T) {
	t.Parallel()
	monitorID := "monitor-window"
	monitorRepository := monitors.NewMemoryRepository([]monitors.Monitor{{
		ID: monitorID, Name: "Window monitor", Slug: "window-monitor",
	}})
	runRepository := NewMemoryRepository()
	service := NewService(monitors.NewService(monitorRepository), runRepository, NewHTTPExecutor(true))
	now := time.Date(2026, time.August, 19, 12, 0, 0, 0, time.UTC)
	for index, status := range []Status{StatusSuccess, StatusFailed, StatusSuccess} {
		if err := runRepository.Save(context.Background(), Run{
			ID:        fmt.Sprintf("run-%d", index),
			MonitorID: monitorID,
			Status:    status,
			CreatedAt: now.Add(-time.Duration(index) * time.Hour),
		}); err != nil {
			t.Fatal(err)
		}
	}

	page, err := service.ListPage(context.Background(), monitorID, PageQuery{
		Limit:  50,
		Since:  now.Add(-90 * time.Minute),
		Status: string(StatusSuccess),
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != "run-0" {
		t.Fatalf("expected only the in-window success run, got %+v", page)
	}
}
