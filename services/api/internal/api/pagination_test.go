package api

import (
	"net/http/httptest"
	"testing"
)

func TestPaginatePreservesLegacyUnpagedResponses(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/v1/monitors", nil)
	items, page, err := paginate(request, []int{1, 2, 3}, 2, 10)
	if err != nil {
		t.Fatal(err)
	}
	if page != nil || len(items) != 3 {
		t.Fatalf("expected legacy response to remain unpaged: items=%v page=%+v", items, page)
	}
}

func TestPaginateReturnsOpaqueNextCursor(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/v1/monitors?limit=2", nil)
	items, page, err := paginate(request, []int{1, 2, 3, 4, 5}, 2, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || page == nil || page.Total != 5 || page.NextCursor == "" {
		t.Fatalf("unexpected first page: items=%v page=%+v", items, page)
	}

	request = httptest.NewRequest("GET", "/api/v1/monitors?limit=2&cursor="+page.NextCursor, nil)
	items, page, err = paginate(request, []int{1, 2, 3, 4, 5}, 2, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0] != 3 || page == nil || page.NextCursor == "" {
		t.Fatalf("unexpected second page: items=%v page=%+v", items, page)
	}
}

func TestPaginateRejectsInvalidInputs(t *testing.T) {
	for _, target := range []string{
		"/api/v1/monitors?limit=0",
		"/api/v1/monitors?limit=11",
		"/api/v1/monitors?cursor=invalid",
	} {
		request := httptest.NewRequest("GET", target, nil)
		if _, _, err := paginate(request, []int{1, 2, 3}, 2, 10); err == nil {
			t.Fatalf("expected pagination error for %s", target)
		}
	}
}

func TestPaginateBoundsLargeOperationalLists(t *testing.T) {
	items := make([]int, 1_250)
	for index := range items {
		items[index] = index + 1
	}
	request := httptest.NewRequest("GET", "/api/v1/audit-events?limit=100", nil)
	firstPage, page, err := paginate(request, items, 50, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(firstPage) != 100 || page == nil || page.Total != 1_250 || page.NextCursor == "" {
		t.Fatalf("large list was not bounded correctly: items=%d page=%+v", len(firstPage), page)
	}
}
