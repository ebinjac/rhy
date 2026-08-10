package browsermonitors

import "testing"

func TestDownsampleMetricPointsBoundsSeriesAndKeepsEndpoints(t *testing.T) {
	points := make([]map[string]any, 2_000)
	for index := range points {
		points[index] = map[string]any{"index": index}
	}

	sampled := downsampleMetricPoints(points, 720)
	if len(sampled) != 720 {
		t.Fatalf("expected 720 sampled points, got %d", len(sampled))
	}
	if sampled[0]["index"] != 0 {
		t.Fatalf("expected first point to be retained, got %#v", sampled[0])
	}
	if sampled[len(sampled)-1]["index"] != 1_999 {
		t.Fatalf("expected last point to be retained, got %#v", sampled[len(sampled)-1])
	}
}

func TestDownsampleMetricPointsLeavesSmallSeriesUnchanged(t *testing.T) {
	points := []map[string]any{{"index": 0}, {"index": 1}}
	sampled := downsampleMetricPoints(points, 720)
	if len(sampled) != len(points) || sampled[0]["index"] != 0 || sampled[1]["index"] != 1 {
		t.Fatalf("small series changed unexpectedly: %#v", sampled)
	}
}
