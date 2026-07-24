package migrations

import (
	"io/fs"
	"strings"
	"testing"
)

func TestEmbeddedUpMigrationsAreTransactionSafe(t *testing.T) {
	entries, err := fs.ReadDir(files, ".")
	if err != nil {
		t.Fatalf("read migrations: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("expected at least one embedded migration")
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".up.sql") {
			continue
		}
		contents, err := files.ReadFile(entry.Name())
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		normalized := strings.ToUpper(string(contents))
		if strings.Contains(normalized, "BEGIN;") || strings.Contains(normalized, "COMMIT;") {
			t.Fatalf("%s contains transaction control; the runner owns the transaction", entry.Name())
		}
	}
}
