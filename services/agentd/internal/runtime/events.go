package runtime

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	runtimev1 "github.com/actiondriver/action-driver/services/agentd/internal/gen/actiondriver/runtime/v1"
	"github.com/actiondriver/action-driver/services/agentd/internal/storage"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (r *Runtime) EventsAfter(ctx context.Context, cursor int64) ([]storage.Event, error) {
	return r.store.EventsAfter(ctx, cursor)
}

func (r *Runtime) persistTaskEvent(ctx context.Context, requestID, eventType string, task storage.Task) error {
	eventID, err := newEventID()
	if err != nil {
		return err
	}
	payload, err := proto.Marshal(&runtimev1.RuntimeEvent{
		EventId:    eventID,
		RequestId:  requestID,
		TaskId:     task.ID,
		EventType:  eventType,
		OccurredAt: timestamppb.New(task.UpdatedAt),
		Payload: &runtimev1.RuntimeEvent_Task{Task: &runtimev1.TaskProjection{
			TaskId: task.ID, Goal: task.Goal, State: taskState(task.State), UpdatedAt: timestamppb.New(task.UpdatedAt),
		}},
	})
	if err != nil {
		return fmt.Errorf("encode task event: %w", err)
	}
	return r.store.WithTx(ctx, func(tx storage.Tx) error {
		if err := tx.SaveTask(task); err != nil {
			return err
		}
		return tx.AppendEvent(storage.Event{ID: eventID, RequestID: requestID, TaskID: task.ID, Type: eventType, Payload: payload, CreatedAt: task.UpdatedAt})
	})
}

func (r *Runtime) persistInvocationEvent(ctx context.Context, requestID, eventType string, invocation storage.SkillInvocation, state runtimev1.SkillState) error {
	eventID, err := newEventID()
	if err != nil {
		return err
	}
	payload, err := proto.Marshal(&runtimev1.RuntimeEvent{
		EventId:    eventID,
		RequestId:  requestID,
		TaskId:     invocation.TaskID,
		EventType:  eventType,
		OccurredAt: timestamppb.New(invocation.UpdatedAt),
		Payload: &runtimev1.RuntimeEvent_SkillInvocation{SkillInvocation: &runtimev1.SkillInvocation{
			InvocationId: invocation.ID, TaskId: invocation.TaskID, SkillId: invocation.SkillID,
			ContractVersion: invocation.ContractVersion, State: state, Input: invocation.Input, Output: invocation.Output,
		}},
	})
	if err != nil {
		return fmt.Errorf("encode skill event: %w", err)
	}
	return r.store.WithTx(ctx, func(tx storage.Tx) error {
		if err := tx.SaveSkillInvocation(invocation); err != nil {
			return err
		}
		return tx.AppendEvent(storage.Event{ID: eventID, RequestID: requestID, TaskID: invocation.TaskID, Type: eventType, Payload: payload, CreatedAt: invocation.UpdatedAt})
	})
}

func newEventID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate event id: %w", err)
	}
	return "event-" + hex.EncodeToString(bytes), nil
}

func taskState(state string) runtimev1.TaskState {
	switch state {
	case "pending":
		return runtimev1.TaskState_TASK_STATE_PENDING
	case "running":
		return runtimev1.TaskState_TASK_STATE_RUNNING
	case "waiting_for_user":
		return runtimev1.TaskState_TASK_STATE_WAITING_FOR_USER
	case "succeeded":
		return runtimev1.TaskState_TASK_STATE_SUCCEEDED
	case "cancelled":
		return runtimev1.TaskState_TASK_STATE_CANCELLED
	case "failed":
		return runtimev1.TaskState_TASK_STATE_FAILED
	default:
		return runtimev1.TaskState_TASK_STATE_UNSPECIFIED
	}
}
