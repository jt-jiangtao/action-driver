package einoadapter

import (
	"context"
	"fmt"
	"strings"
)

type DeterministicDriver struct{}

func NewDeterministicDriver() *DeterministicDriver {
	return &DeterministicDriver{}
}

func (d *DeterministicDriver) Run(ctx context.Context, goal Goal) (Plan, error) {
	if err := ctx.Err(); err != nil {
		return Plan{}, err
	}
	if strings.TrimSpace(goal.Text) == "" {
		return Plan{}, fmt.Errorf("goal text is required")
	}
	return Plan{Goal: goal.Text}, nil
}
