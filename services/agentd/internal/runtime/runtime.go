package runtime

import (
	"context"
	"fmt"
	"time"

	"github.com/actiondriver/action-driver/services/agentd/internal/einoadapter"
	runtimev1 "github.com/actiondriver/action-driver/services/agentd/internal/gen/actiondriver/runtime/v1"
	"github.com/actiondriver/action-driver/services/agentd/internal/skills"
	"github.com/actiondriver/action-driver/services/agentd/internal/storage"
)

type Error struct {
	Code    runtimev1.ErrorCode
	Message string
}

func (e *Error) Error() string {
	return e.Message
}

type Option func(*Runtime)

func WithClock(clock func() time.Time) Option {
	return func(runtime *Runtime) {
		runtime.clock = clock
	}
}

type Runtime struct {
	store    storage.Store
	driver   einoadapter.Driver
	registry *skills.Registry
	clock    func() time.Time
}

func New(store storage.Store, driver einoadapter.Driver, registry *skills.Registry, options ...Option) *Runtime {
	runtime := &Runtime{store: store, driver: driver, registry: registry, clock: time.Now}
	for _, option := range options {
		option(runtime)
	}
	return runtime
}

func (r *Runtime) SubmitGoal(ctx context.Context, requestID, taskID, goal string) error {
	plan, err := r.driver.Run(ctx, einoadapter.Goal{Text: goal})
	if err != nil {
		return &Error{Code: runtimev1.ErrorCode_ERROR_CODE_INVALID_COMMAND, Message: err.Error()}
	}
	task := storage.Task{ID: taskID, Goal: plan.Goal, State: "running", UpdatedAt: r.clock()}
	return r.persistTaskEvent(ctx, requestID, "task.running", task)
}

func (r *Runtime) InterruptTask(ctx context.Context, requestID, taskID string) error {
	return r.setTaskState(ctx, requestID, taskID, "waiting_for_user", "task.interrupted")
}

func (r *Runtime) ContinueTask(ctx context.Context, requestID, taskID string) error {
	return r.setTaskState(ctx, requestID, taskID, "running", "task.continued")
}

func (r *Runtime) setTaskState(ctx context.Context, requestID, taskID, state, eventType string) error {
	task, err := r.store.Task(ctx, taskID)
	if err != nil {
		return &Error{Code: runtimev1.ErrorCode_ERROR_CODE_INVALID_COMMAND, Message: fmt.Sprintf("task %s: %v", taskID, err)}
	}
	task.State = state
	task.UpdatedAt = r.clock()
	return r.persistTaskEvent(ctx, requestID, eventType, task)
}

func (r *Runtime) InvokeSkill(ctx context.Context, requestID string, invocation storage.SkillInvocation) (skills.Result, error) {
	provider, ok := r.registry.Resolve(invocation.SkillID, invocation.ContractVersion)
	if !ok {
		return skills.Result{}, &Error{
			Code:    runtimev1.ErrorCode_ERROR_CODE_CAPABILITY_UNAVAILABLE,
			Message: fmt.Sprintf("capability %s@%s is unavailable", invocation.SkillID, invocation.ContractVersion),
		}
	}

	invocation.State = "queued"
	invocation.UpdatedAt = r.clock()
	if err := r.persistInvocationEvent(ctx, requestID, "skill.invocation.queued", invocation, runtimev1.SkillState_SKILL_STATE_QUEUED); err != nil {
		return skills.Result{}, err
	}

	result, err := provider.Invoke(ctx, skills.Invocation{
		ID:              invocation.ID,
		TaskID:          invocation.TaskID,
		SkillID:         invocation.SkillID,
		ContractVersion: invocation.ContractVersion,
		Input:           invocation.Input,
	})
	if err != nil {
		invocation.State = "failed"
		invocation.Error = []byte(err.Error())
		invocation.UpdatedAt = r.clock()
		if persistErr := r.persistInvocationEvent(ctx, requestID, "skill.invocation.failed", invocation, runtimev1.SkillState_SKILL_STATE_FAILED); persistErr != nil {
			return skills.Result{}, persistErr
		}
		return skills.Result{}, &Error{Code: runtimev1.ErrorCode_ERROR_CODE_INTERNAL, Message: err.Error()}
	}

	invocation.State = "succeeded"
	invocation.Output = result.Output
	invocation.UpdatedAt = r.clock()
	if err := r.persistInvocationEvent(ctx, requestID, "skill.invocation.succeeded", invocation, runtimev1.SkillState_SKILL_STATE_SUCCEEDED); err != nil {
		return skills.Result{}, err
	}
	return result, nil
}
