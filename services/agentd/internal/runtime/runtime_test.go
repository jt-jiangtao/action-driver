package runtime

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/actiondriver/action-driver/services/agentd/internal/einoadapter"
	runtimev1 "github.com/actiondriver/action-driver/services/agentd/internal/gen/actiondriver/runtime/v1"
	"github.com/actiondriver/action-driver/services/agentd/internal/skills"
	"github.com/actiondriver/action-driver/services/agentd/internal/storage"
	storagesqlite "github.com/actiondriver/action-driver/services/agentd/internal/storage/sqlite"
)

type observingProvider struct {
	store      storage.Store
	sawQueued  bool
	capability skills.Capability
}

func (p *observingProvider) ProviderID() string { return "browser-provider" }
func (p *observingProvider) Capabilities() []skills.Capability {
	return []skills.Capability{p.capability}
}
func (p *observingProvider) Invoke(ctx context.Context, invocation skills.Invocation) (skills.Result, error) {
	events, err := p.store.EventsAfter(ctx, 0)
	if err != nil {
		return skills.Result{}, err
	}
	p.sawQueued = len(events) == 1 && events[0].Type == "skill.invocation.queued"
	return skills.Result{Output: []byte(`{"ok":true}`)}, nil
}

func TestInvokeSkillRejectsUnavailableCapability(t *testing.T) {
	runtime, store := openRuntime(t, skills.NewRegistry())
	seedTask(t, store)

	_, err := runtime.InvokeSkill(context.Background(), "req-1", storage.SkillInvocation{
		ID: "inv-1", TaskID: "task-1", SkillID: "browser.use", ContractVersion: "1.0.0", Input: []byte(`{}`),
	})
	assertRuntimeErrorCode(t, err, runtimev1.ErrorCode_ERROR_CODE_CAPABILITY_UNAVAILABLE)
	events, queryErr := store.EventsAfter(context.Background(), 0)
	if queryErr != nil {
		t.Fatalf("query events: %v", queryErr)
	}
	if len(events) != 0 {
		t.Fatalf("unexpected events: %#v", events)
	}
}

func TestInvokeSkillPersistsQueuedBeforeProviderAndPublishesOrderedLifecycle(t *testing.T) {
	registry := skills.NewRegistry()
	runtime, store := openRuntime(t, registry)
	seedTask(t, store)
	provider := &observingProvider{store: store, capability: skills.Capability{SkillID: "browser.use", ContractVersion: "1.0.0"}}
	if err := registry.Register(provider); err != nil {
		t.Fatalf("register provider: %v", err)
	}

	result, err := runtime.InvokeSkill(context.Background(), "req-1", storage.SkillInvocation{
		ID: "inv-1", TaskID: "task-1", SkillID: "browser.use", ContractVersion: "1.0.0", Input: []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("invoke skill: %v", err)
	}
	if !provider.sawQueued {
		t.Fatal("provider ran before queued state and event committed")
	}
	if string(result.Output) != `{"ok":true}` {
		t.Fatalf("result = %s", result.Output)
	}

	events, err := runtime.EventsAfter(context.Background(), 0)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	if len(events) != 2 || events[0].Type != "skill.invocation.queued" || events[1].Type != "skill.invocation.succeeded" {
		t.Fatalf("lifecycle events = %#v", events)
	}
	if events[0].Cursor >= events[1].Cursor {
		t.Fatalf("event cursors are not ordered: %#v", events)
	}
}

func TestTaskCommandsPersistStateAndEvents(t *testing.T) {
	runtime, store := openRuntime(t, skills.NewRegistry())
	ctx := context.Background()
	if err := runtime.SubmitGoal(ctx, "req-submit", "task-1", "book a hotel"); err != nil {
		t.Fatalf("submit goal: %v", err)
	}
	if err := runtime.InterruptTask(ctx, "req-interrupt", "task-1"); err != nil {
		t.Fatalf("interrupt task: %v", err)
	}
	if err := runtime.ContinueTask(ctx, "req-continue", "task-1"); err != nil {
		t.Fatalf("continue task: %v", err)
	}

	task, err := store.Task(ctx, "task-1")
	if err != nil {
		t.Fatalf("load task: %v", err)
	}
	if task.Goal != "book a hotel" || task.State != "running" {
		t.Fatalf("task = %#v", task)
	}
	events, err := runtime.EventsAfter(ctx, 0)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	if len(events) != 3 || events[0].Type != "task.running" || events[1].Type != "task.interrupted" || events[2].Type != "task.continued" {
		t.Fatalf("task events = %#v", events)
	}
}

func openRuntime(t *testing.T, registry *skills.Registry) (*Runtime, storage.Store) {
	t.Helper()
	store, err := storagesqlite.Open(context.Background(), filepath.Join(t.TempDir(), "runtime.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	runtime := New(store, einoadapter.NewDeterministicDriver(), registry, WithClock(func() time.Time {
		return time.Date(2026, 9, 20, 8, 0, 0, 0, time.UTC)
	}))
	return runtime, store
}

func seedTask(t *testing.T, store storage.Store) {
	t.Helper()
	err := store.WithTx(context.Background(), func(tx storage.Tx) error {
		return tx.SaveTask(storage.Task{ID: "task-1", Goal: "test", State: "running", UpdatedAt: time.Now()})
	})
	if err != nil {
		t.Fatalf("seed task: %v", err)
	}
}

func skillInvocationFixture() storage.SkillInvocation {
	return storage.SkillInvocation{
		ID: "inv-1", TaskID: "task-1", SkillID: "browser.use", ContractVersion: "1.0.0", Input: []byte(`{}`),
	}
}

func assertRuntimeErrorCode(t *testing.T, err error, want runtimev1.ErrorCode) {
	t.Helper()
	runtimeError, ok := err.(*Error)
	if !ok {
		t.Fatalf("error = %T %v", err, err)
	}
	if runtimeError.Code != want {
		t.Fatalf("error code = %v, want %v", runtimeError.Code, want)
	}
}
