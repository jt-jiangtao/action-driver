package sqlite

import (
	"context"
	"database/sql"
	"testing"
	"testing/fstest"

	_ "modernc.org/sqlite"
)

func TestMigrationsAreIdempotentAndChecksummed(t *testing.T) {
	db := openMemoryDatabase(t)
	migrations := fstest.MapFS{
		"migrations/0001_test.sql": {Data: []byte("CREATE TABLE test_records (id TEXT PRIMARY KEY);")},
	}
	if err := applyMigrations(context.Background(), db, migrations); err != nil {
		t.Fatalf("first migration: %v", err)
	}
	if err := applyMigrations(context.Background(), db, migrations); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}

	migrations["migrations/0001_test.sql"] = &fstest.MapFile{Data: []byte("CREATE TABLE changed (id TEXT PRIMARY KEY);")}
	if err := applyMigrations(context.Background(), db, migrations); err == nil {
		t.Fatal("expected checksum mismatch")
	}
}

func TestBrokenMigrationRollsBackSchemaAndVersion(t *testing.T) {
	db := openMemoryDatabase(t)
	migrations := fstest.MapFS{
		"migrations/0001_broken.sql": {Data: []byte("CREATE TABLE partial_write (id TEXT); INVALID SQL;")},
	}
	if err := applyMigrations(context.Background(), db, migrations); err == nil {
		t.Fatal("expected migration failure")
	}

	var tables int
	if err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'partial_write'").Scan(&tables); err != nil {
		t.Fatalf("inspect schema: %v", err)
	}
	if tables != 0 {
		t.Fatal("partial schema escaped the transaction")
	}
	var versions int
	if err := db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&versions); err != nil {
		t.Fatalf("inspect migration versions: %v", err)
	}
	if versions != 0 {
		t.Fatal("failed migration recorded a schema version")
	}
}

func openMemoryDatabase(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+t.Name()+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}
