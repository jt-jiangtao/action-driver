package storage

import (
	"context"
	"errors"
	"time"
)

var ErrNotFound = errors.New("storage record not found")

type Task struct {
	ID        string
	Goal      string
	State     string
	UpdatedAt time.Time
}

type Message struct {
	ID        string
	TaskID    string
	Role      string
	Content   string
	CreatedAt time.Time
}

type Step struct {
	ID        string
	TaskID    string
	Title     string
	Summary   string
	State     string
	UpdatedAt time.Time
}

type SkillInvocation struct {
	ID              string
	TaskID          string
	SkillID         string
	ContractVersion string
	State           string
	Input           []byte
	Output          []byte
	Error           []byte
	UpdatedAt       time.Time
}

type Event struct {
	Cursor    int64
	ID        string
	RequestID string
	TaskID    string
	Type      string
	Payload   []byte
	CreatedAt time.Time
}

type Tx interface {
	SaveTask(Task) error
	SaveMessage(Message) error
	SaveStep(Step) error
	SaveSkillInvocation(SkillInvocation) error
	AppendEvent(Event) error
}

type Store interface {
	WithTx(context.Context, func(Tx) error) error
	Task(context.Context, string) (Task, error)
	EventsAfter(context.Context, int64) ([]Event, error)
	Close() error
}
