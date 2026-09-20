package sqlite

import (
	"context"
	"errors"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/actiondriver/action-driver/services/agentd/internal/storage"
)

func openTempStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "runtime.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("close store: %v", err)
		}
	})
	return store
}

func TestSkillStateAndEventRollbackTogether(t *testing.T) {
	store := openTempStore(t)
	err := store.WithTx(context.Background(), func(tx storage.Tx) error {
		if err := tx.SaveTask(storage.Task{ID: "task-1", Goal: "test", State: "running", UpdatedAt: time.Now()}); err != nil {
			return err
		}
		if err := tx.SaveSkillInvocation(storage.SkillInvocation{ID: "inv-1", TaskID: "task-1", SkillID: "browser.use", ContractVersion: "1.0.0", State: "running", UpdatedAt: time.Now()}); err != nil {
			return err
		}
		if err := tx.AppendEvent(storage.Event{Cursor: 1, ID: "event-1", TaskID: "task-1", Type: "skill.running", Payload: []byte(`{"state":"running"}`), CreatedAt: time.Now()}); err != nil {
			return err
		}
		return errors.New("rollback")
	})
	if err == nil {
		t.Fatal("expected transaction error")
	}

	assertTableCount(t, store, "tasks", 0)
	assertTableCount(t, store, "skill_invocations", 0)
	assertTableCount(t, store, "runtime_events", 0)
}

func TestOpenConfiguresSQLiteAndSupportsIdempotentRestart(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "runtime.db")
	store, err := Open(context.Background(), databasePath)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}

	var journalMode string
	var foreignKeys int
	var busyTimeout int
	if err := store.db.QueryRow("PRAGMA journal_mode").Scan(&journalMode); err != nil {
		t.Fatalf("read journal mode: %v", err)
	}
	if err := store.db.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys); err != nil {
		t.Fatalf("read foreign keys: %v", err)
	}
	if err := store.db.QueryRow("PRAGMA busy_timeout").Scan(&busyTimeout); err != nil {
		t.Fatalf("read busy timeout: %v", err)
	}
	if journalMode != "wal" || foreignKeys != 1 || busyTimeout != 5000 {
		t.Fatalf("pragmas = journal_mode:%s foreign_keys:%d busy_timeout:%d", journalMode, foreignKeys, busyTimeout)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close first store: %v", err)
	}

	reopened, err := Open(context.Background(), databasePath)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	if err := reopened.Close(); err != nil {
		t.Fatalf("close reopened store: %v", err)
	}
}

func TestEventsAfterReturnsStrictlyNewerCursors(t *testing.T) {
	store := openTempStore(t)
	err := store.WithTx(context.Background(), func(tx storage.Tx) error {
		if err := tx.SaveTask(storage.Task{ID: "task-1", Goal: "test", State: "running", UpdatedAt: time.Now()}); err != nil {
			return err
		}
		for _, cursor := range []int64{1, 2, 3} {
			if err := tx.AppendEvent(storage.Event{Cursor: cursor, ID: "event-" + strconv.FormatInt(cursor, 10), TaskID: "task-1", Type: "test", Payload: []byte(`{}`), CreatedAt: time.Now()}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("commit fixtures: %v", err)
	}

	events, err := store.EventsAfter(context.Background(), 1)
	if err != nil {
		t.Fatalf("events after cursor: %v", err)
	}
	if len(events) != 2 || events[0].Cursor != 2 || events[1].Cursor != 3 {
		t.Fatalf("events = %#v", events)
	}
}

func assertTableCount(t *testing.T, store *Store, table string, want int) {
	t.Helper()
	var got int
	if err := store.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&got); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	if got != want {
		t.Fatalf("%s count = %d, want %d", table, got, want)
	}
}
