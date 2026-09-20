package skills

import (
	"context"
	"fmt"
	"sync"
)

type Capability struct {
	SkillID         string
	ContractVersion string
}

type Invocation struct {
	ID              string
	TaskID          string
	SkillID         string
	ContractVersion string
	Input           []byte
}

type Result struct {
	Output []byte
}

type Provider interface {
	ProviderID() string
	Capabilities() []Capability
	Invoke(context.Context, Invocation) (Result, error)
}

type capabilityKey struct {
	skillID         string
	contractVersion string
}

type Registry struct {
	mu           sync.RWMutex
	providers    map[capabilityKey]Provider
	providerKeys map[string][]capabilityKey
}

func NewRegistry() *Registry {
	return &Registry{
		providers:    make(map[capabilityKey]Provider),
		providerKeys: make(map[string][]capabilityKey),
	}
}

func (r *Registry) Register(provider Provider) error {
	if provider == nil || provider.ProviderID() == "" {
		return fmt.Errorf("provider id is required")
	}
	capabilities := provider.Capabilities()
	if len(capabilities) == 0 {
		return fmt.Errorf("provider %s has no capabilities", provider.ProviderID())
	}
	for _, capability := range capabilities {
		if capability.SkillID == "" || capability.ContractVersion == "" {
			return fmt.Errorf("provider %s has an incomplete capability", provider.ProviderID())
		}
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	keys := make([]capabilityKey, 0, len(capabilities))
	for _, capability := range capabilities {
		key := capabilityKey{skillID: capability.SkillID, contractVersion: capability.ContractVersion}
		if existing, ok := r.providers[key]; ok && existing.ProviderID() != provider.ProviderID() {
			return fmt.Errorf("capability %s@%s is already registered", capability.SkillID, capability.ContractVersion)
		}
		keys = append(keys, key)
	}
	r.unregisterLocked(provider.ProviderID())
	for _, key := range keys {
		r.providers[key] = provider
	}
	r.providerKeys[provider.ProviderID()] = keys
	return nil
}

func (r *Registry) Unregister(providerID string) error {
	if providerID == "" {
		return fmt.Errorf("provider id is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.unregisterLocked(providerID)
	return nil
}

func (r *Registry) unregisterLocked(providerID string) {
	for _, key := range r.providerKeys[providerID] {
		delete(r.providers, key)
	}
	delete(r.providerKeys, providerID)
}

func (r *Registry) Resolve(skillID, contractVersion string) (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	provider, ok := r.providers[capabilityKey{skillID: skillID, contractVersion: contractVersion}]
	return provider, ok
}

func (r *Registry) Available(skillID, contractVersion string) bool {
	_, ok := r.Resolve(skillID, contractVersion)
	return ok
}
