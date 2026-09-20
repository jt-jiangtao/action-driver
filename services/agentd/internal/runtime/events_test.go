package runtime

import (
	"context"
	"testing"

	"github.com/actiondriver/action-driver/services/agentd/internal/skills"
)

func TestEventsAfterDoesNotReplayAcknowledgedCursor(t *testing.T) {
	runtime, store := openRuntime(t, skills.NewRegistry())
	seedTask(t, store)
	provider := &observingProvider{store: store, capability: skills.Capability{SkillID: "browser.use", ContractVersion: "1.0.0"}}
	if err := runtime.registry.Register(provider); err != nil {
		t.Fatalf("register provider: %v", err)
	}
	if _, err := runtime.InvokeSkill(context.Background(), "req-1", skillInvocationFixture()); err != nil {
		t.Fatalf("invoke skill: %v", err)
	}

	all, err := runtime.EventsAfter(context.Background(), 0)
	if err != nil {
		t.Fatalf("all events: %v", err)
	}
	resumed, err := runtime.EventsAfter(context.Background(), all[0].Cursor)
	if err != nil {
		t.Fatalf("resumed events: %v", err)
	}
	if len(resumed) != 1 || resumed[0].Cursor != all[1].Cursor {
		t.Fatalf("resumed events = %#v", resumed)
	}
}
