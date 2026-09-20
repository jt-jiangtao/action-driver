package app

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/actiondriver/action-driver/services/agentd/internal/einoadapter"
)

func TestConfigRejectsMissingPrivatePaths(t *testing.T) {
	_, err := ParseConfig([]string{"--socket", "", "--database", ""})
	if err == nil {
		t.Fatal("expected missing private paths to be rejected")
	}
}

func TestServiceStartsWithoutModelCredentials(t *testing.T) {
	root := t.TempDir()
	config, err := ParseConfig([]string{
		"--socket", filepath.Join(root, "agentd.sock"),
		"--database", filepath.Join(root, "runtime.db"),
		"--session-token", "test-session-token",
	})
	if err != nil {
		t.Fatalf("parse config: %v", err)
	}

	service := NewService(config, einoadapter.NewDeterministicDriver())
	defer service.Stop()
	if err := service.Start(context.Background()); err != nil {
		t.Fatalf("start service: %v", err)
	}
	if !service.Ready() {
		t.Fatal("service should report ready")
	}
}
