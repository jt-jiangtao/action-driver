package skills

import (
	"context"
	"testing"
)

type stubProvider struct {
	id           string
	capabilities []Capability
	invoke       func(context.Context, Invocation) (Result, error)
}

func (p *stubProvider) ProviderID() string         { return p.id }
func (p *stubProvider) Capabilities() []Capability { return p.capabilities }
func (p *stubProvider) Invoke(ctx context.Context, invocation Invocation) (Result, error) {
	if p.invoke == nil {
		return Result{}, nil
	}
	return p.invoke(ctx, invocation)
}

func TestBrowserProviderDoesNotChangeComputerProvider(t *testing.T) {
	registry := NewRegistry()
	browser := &stubProvider{id: "browser-provider", capabilities: []Capability{{SkillID: "browser.use", ContractVersion: "1.0.0"}}}
	computer := &stubProvider{id: "computer-provider", capabilities: []Capability{{SkillID: "computer.use", ContractVersion: "1.0.0"}}}

	if err := registry.Register(browser); err != nil {
		t.Fatalf("register browser: %v", err)
	}
	if err := registry.Register(computer); err != nil {
		t.Fatalf("register computer: %v", err)
	}
	if err := registry.Unregister(browser.ProviderID()); err != nil {
		t.Fatalf("unregister browser: %v", err)
	}

	if registry.Available("browser.use", "1.0.0") {
		t.Fatal("browser capability should be offline")
	}
	if !registry.Available("computer.use", "1.0.0") {
		t.Fatal("computer capability should remain online")
	}
}

func TestRegistryResolvesExactContractVersion(t *testing.T) {
	registry := NewRegistry()
	provider := &stubProvider{id: "browser-provider", capabilities: []Capability{{SkillID: "browser.use", ContractVersion: "1.0.0"}}}
	if err := registry.Register(provider); err != nil {
		t.Fatalf("register provider: %v", err)
	}

	if _, ok := registry.Resolve("browser.use", "1.0.0"); !ok {
		t.Fatal("expected exact capability match")
	}
	if _, ok := registry.Resolve("browser.use", "2.0.0"); ok {
		t.Fatal("unexpected incompatible capability match")
	}
}
