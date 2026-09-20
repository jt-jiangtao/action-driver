package einoadapter

import (
	"context"
	"testing"
)

func TestDeterministicDriverDoesNotRequireModelCredentials(t *testing.T) {
	plan, err := NewDeterministicDriver().Run(context.Background(), Goal{Text: "test"})
	if err != nil {
		t.Fatalf("run deterministic driver: %v", err)
	}
	if plan.Goal != "test" {
		t.Fatalf("plan goal = %q, want test", plan.Goal)
	}
}

func TestGraphDriverUsesReplaceableNode(t *testing.T) {
	driver, err := NewGraphDriver(NewDeterministicDriver())
	if err != nil {
		t.Fatalf("create graph driver: %v", err)
	}
	plan, err := driver.Run(context.Background(), Goal{Text: "graph"})
	if err != nil {
		t.Fatalf("run graph driver: %v", err)
	}
	if plan.Goal != "graph" {
		t.Fatalf("plan goal = %q, want graph", plan.Goal)
	}
}
