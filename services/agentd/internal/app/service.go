package app

import (
	"context"
	"fmt"
	"sync/atomic"

	"github.com/actiondriver/action-driver/services/agentd/internal/einoadapter"
	runtimev1 "github.com/actiondriver/action-driver/services/agentd/internal/gen/actiondriver/runtime/v1"
	"github.com/actiondriver/action-driver/services/agentd/internal/storage/sqlite"
)

const RuntimeVersion = "0.1.0"

type Service struct {
	config Config
	driver einoadapter.Driver
	store  *sqlite.Store
	ready  atomic.Bool
}

func NewService(config Config, driver einoadapter.Driver) *Service {
	return &Service{config: config, driver: driver}
}

func (s *Service) Start(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.driver == nil {
		return fmt.Errorf("runtime driver is required")
	}
	if s.config.SocketPath == "" || s.config.DatabasePath == "" || s.config.SessionToken == "" {
		return fmt.Errorf("runtime config is incomplete")
	}
	store, err := sqlite.Open(ctx, s.config.DatabasePath)
	if err != nil {
		return fmt.Errorf("open runtime store: %w", err)
	}
	s.store = store
	s.ready.Store(true)
	return nil
}

func (s *Service) Ready() bool {
	return s.ready.Load()
}

func (s *Service) Health(requestID string) *runtimev1.HealthResponse {
	return &runtimev1.HealthResponse{
		RequestId:      requestID,
		Ready:          s.Ready(),
		RuntimeVersion: RuntimeVersion,
	}
}

func (s *Service) Stop() {
	s.ready.Store(false)
	if s.store != nil {
		_ = s.store.Close()
		s.store = nil
	}
}
