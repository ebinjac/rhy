package postgres

import "testing"

func TestFormatIntervalDuration(t *testing.T) {
	cases := []struct {
		seconds int
		want    string
	}{
		{0, "0s"},
		{10, "10s"},
		{60, "1m"},
		{300, "5m"},
		{90, "1m30s"},
		{3600, "1h"},
		{3661, "1h1m1s"},
		{7200, "2h"},
	}
	for _, tc := range cases {
		if got := formatIntervalDuration(tc.seconds); got != tc.want {
			t.Fatalf("formatIntervalDuration(%d) = %q, want %q", tc.seconds, got, tc.want)
		}
	}
}

func TestScheduleSummaryInterval(t *testing.T) {
	if got := scheduleSummary("INTERVAL", "", 300); got != "Every 5m" {
		t.Fatalf("scheduleSummary INTERVAL 300 = %q, want %q", got, "Every 5m")
	}
}
