package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/actiondriver/action-driver/services/agentd/internal/storage"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(ctx context.Context, databasePath string) (*Store, error) {
	if databasePath == "" || !filepath.IsAbs(databasePath) {
		return nil, fmt.Errorf("database path must be absolute")
	}
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	store := &Store{db: db}
	if err := configure(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := applyMigrations(ctx, db, embeddedMigrations); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := os.Chmod(databasePath, 0o600); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("secure database permissions: %w", err)
	}
	return store, nil
}

func configure(ctx context.Context, db *sql.DB) error {
	for _, pragma := range []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
	} {
		if _, err := db.ExecContext(ctx, pragma); err != nil {
			return fmt.Errorf("configure sqlite with %q: %w", pragma, err)
		}
	}
	return nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) WithTx(ctx context.Context, fn func(storage.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := fn(&sqliteTx{ctx: ctx, tx: tx}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

func (s *Store) EventsAfter(ctx context.Context, cursor int64) ([]storage.Event, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT cursor, id, request_id, task_id, event_type, payload, created_at
		FROM runtime_events
		WHERE cursor > ?
		ORDER BY cursor ASC
	`, cursor)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	var events []storage.Event
	for rows.Next() {
		var event storage.Event
		var createdAt string
		if err := rows.Scan(&event.Cursor, &event.ID, &event.RequestID, &event.TaskID, &event.Type, &event.Payload, &createdAt); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		parsed, err := time.Parse(time.RFC3339Nano, createdAt)
		if err != nil {
			return nil, fmt.Errorf("parse event timestamp: %w", err)
		}
		event.CreatedAt = parsed
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate events: %w", err)
	}
	return events, nil
}

type sqliteTx struct {
	ctx context.Context
	tx  *sql.Tx
}

func (t *sqliteTx) SaveTask(task storage.Task) error {
	_, err := t.tx.ExecContext(t.ctx, `
		INSERT INTO tasks(id, goal, state, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET goal = excluded.goal, state = excluded.state, updated_at = excluded.updated_at
	`, task.ID, task.Goal, task.State, formatTime(task.UpdatedAt))
	return wrapWriteError("save task", err)
}

func (t *sqliteTx) SaveMessage(message storage.Message) error {
	_, err := t.tx.ExecContext(t.ctx, `
		INSERT INTO messages(id, task_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET role = excluded.role, content = excluded.content
	`, message.ID, message.TaskID, message.Role, message.Content, formatTime(message.CreatedAt))
	return wrapWriteError("save message", err)
}

func (t *sqliteTx) SaveStep(step storage.Step) error {
	_, err := t.tx.ExecContext(t.ctx, `
		INSERT INTO steps(id, task_id, title, summary, state, updated_at) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET title = excluded.title, summary = excluded.summary, state = excluded.state, updated_at = excluded.updated_at
	`, step.ID, step.TaskID, step.Title, step.Summary, step.State, formatTime(step.UpdatedAt))
	return wrapWriteError("save step", err)
}

func (t *sqliteTx) SaveSkillInvocation(invocation storage.SkillInvocation) error {
	_, err := t.tx.ExecContext(t.ctx, `
		INSERT INTO skill_invocations(id, task_id, skill_id, contract_version, state, input, output, error, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET state = excluded.state, output = excluded.output, error = excluded.error, updated_at = excluded.updated_at
	`, invocation.ID, invocation.TaskID, invocation.SkillID, invocation.ContractVersion, invocation.State, invocation.Input, invocation.Output, invocation.Error, formatTime(invocation.UpdatedAt))
	return wrapWriteError("save skill invocation", err)
}

func (t *sqliteTx) AppendEvent(event storage.Event) error {
	var err error
	if event.Cursor > 0 {
		_, err = t.tx.ExecContext(t.ctx, `
			INSERT INTO runtime_events(cursor, id, request_id, task_id, event_type, payload, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, event.Cursor, event.ID, event.RequestID, event.TaskID, event.Type, event.Payload, formatTime(event.CreatedAt))
	} else {
		_, err = t.tx.ExecContext(t.ctx, `
			INSERT INTO runtime_events(id, request_id, task_id, event_type, payload, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, event.ID, event.RequestID, event.TaskID, event.Type, event.Payload, formatTime(event.CreatedAt))
	}
	return wrapWriteError("append event", err)
}

func formatTime(value time.Time) string {
	if value.IsZero() {
		value = time.Now()
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func wrapWriteError(operation string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", operation, err)
}
