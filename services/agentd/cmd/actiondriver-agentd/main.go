package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/actiondriver/action-driver/services/agentd/internal/app"
	"github.com/actiondriver/action-driver/services/agentd/internal/einoadapter"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	config, err := app.ParseConfig(args)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}
	driver, err := einoadapter.NewGraphDriver(einoadapter.NewDeterministicDriver())
	if err != nil {
		return fmt.Errorf("create runtime driver: %w", err)
	}
	service := app.NewService(config, driver)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := service.Start(ctx); err != nil {
		return fmt.Errorf("start service: %w", err)
	}
	defer service.Stop()

	<-ctx.Done()
	return nil
}
