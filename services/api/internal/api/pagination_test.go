package api

import (
	"net/http/httptest"
	"testing"
	"time"
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

func TestTimeIDCursorRoundTrip(t *testing.T) {
	timestamp := time.Date(2026, time.July, 31, 4, 45, 12, 987654321, time.FixedZone("IST", 5*60*60+30*60))
	cursor := encodeTimeIDCursor("alert", timestamp, "7882db98-7e0d-4604-81b3-d4914a192130")
	decodedTimestamp, decodedID, err := decodeTimeIDCursor(cursor, "alert")
	if err != nil {
		t.Fatal(err)
	}
	if !decodedTimestamp.Equal(timestamp) || decodedID != "7882db98-7e0d-4604-81b3-d4914a192130" {
		t.Fatalf("unexpected cursor values: timestamp=%s id=%s", decodedTimestamp, decodedID)
	}
}

func TestTimeIDCursorRejectsWrongKindAndMalformedValues(t *testing.T) {
	valid := encodeTimeIDCursor("deployment", time.Now(), "7882db98-7e0d-4604-81b3-d4914a192130")
	for _, test := range []struct {
		cursor string
		kind   string
	}{
		{cursor: valid, kind: "alert"},
		{cursor: "not-base64", kind: "deployment"},
		{cursor: encodeTimeIDCursor("deployment", time.Now(), ""), kind: "deployment"},
	} {
		if _, _, err := decodeTimeIDCursor(test.cursor, test.kind); err == nil {
			t.Fatalf("expected cursor to be rejected: kind=%s cursor=%s", test.kind, test.cursor)
		}
	}
}

func TestSequenceCursorRoundTrip(t *testing.T) {
	cursor := encodeSequenceCursor("run-event", 42)
	sequence, err := decodeSequenceCursor(cursor, "run-event")
	if err != nil {
		t.Fatal(err)
	}
	if sequence != 42 {
		t.Fatalf("expected sequence 42, got %d", sequence)
	}
	if _, err := decodeSequenceCursor(cursor, "another-kind"); err == nil {
		t.Fatal("expected cursor kind mismatch to be rejected")
	}
}
