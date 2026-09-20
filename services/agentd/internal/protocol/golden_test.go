package protocol_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	runtimev1 "github.com/actiondriver/action-driver/services/agentd/internal/gen/actiondriver/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestRuntimeContractGoldenRoundTrip(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test path")
	}
	fixturePath := filepath.Join(filepath.Dir(filename), "..", "..", "..", "..", "proto", "actiondriver", "runtime", "v1", "testdata", "runtime-envelope.json")
	data, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	wire := new(runtimev1.RuntimeContractFixture)
	if err := protojson.Unmarshal(data, wire); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	encoded, err := proto.Marshal(wire)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	decoded := new(runtimev1.RuntimeContractFixture)
	if err := proto.Unmarshal(encoded, decoded); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}

	if got := decoded.GetContext().GetRequestId(); got != "req-golden-001" {
		t.Fatalf("request id = %q", got)
	}
	if got := decoded.GetHandshake().GetProtocolMajor(); got != 1 {
		t.Fatalf("protocol major = %d", got)
	}
	if got := decoded.GetError().GetCode(); got != runtimev1.ErrorCode_ERROR_CODE_PROTOCOL_INCOMPATIBLE {
		t.Fatalf("error code = %v", got)
	}
	if got := decoded.GetInvocation().GetState(); got != runtimev1.SkillState_SKILL_STATE_QUEUED {
		t.Fatalf("skill state = %v", got)
	}
	if got := decoded.GetEvent().GetCursor(); got != 42 {
		t.Fatalf("event cursor = %d", got)
	}
}
