package einoadapter

import (
	"context"
	"fmt"

	"github.com/cloudwego/eino/compose"
)

// Goal is the model-independent input accepted by the agent planning seam.
type Goal struct {
	Text string
}

// Plan is the model-independent output produced by the agent planning seam.
type Plan struct {
	Goal string
}

// Driver isolates the runtime from any concrete model or graph implementation.
type Driver interface {
	Run(context.Context, Goal) (Plan, error)
}

// GraphDriver executes a replaceable Driver node through an Eino graph.
type GraphDriver struct {
	runnable compose.Runnable[Goal, Plan]
}

func NewGraphDriver(node Driver) (*GraphDriver, error) {
	if node == nil {
		return nil, fmt.Errorf("driver node is required")
	}

	graph := compose.NewGraph[Goal, Plan]()
	if err := graph.AddLambdaNode("driver", compose.InvokableLambda(node.Run)); err != nil {
		return nil, fmt.Errorf("add driver node: %w", err)
	}
	if err := graph.AddEdge(compose.START, "driver"); err != nil {
		return nil, fmt.Errorf("connect graph input: %w", err)
	}
	if err := graph.AddEdge("driver", compose.END); err != nil {
		return nil, fmt.Errorf("connect graph output: %w", err)
	}
	runnable, err := graph.Compile(context.Background(), compose.WithGraphName("actiondriver-runtime"))
	if err != nil {
		return nil, fmt.Errorf("compile driver graph: %w", err)
	}

	return &GraphDriver{runnable: runnable}, nil
}

func (d *GraphDriver) Run(ctx context.Context, goal Goal) (Plan, error) {
	return d.runnable.Invoke(ctx, goal)
}
