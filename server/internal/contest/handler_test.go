package contest

import (
	"encoding/json"
	"testing"
)

func TestValidateCreateRequest(t *testing.T) {
	tests := []struct {
		name string
		req  createRequest
		ok   bool
	}{
		{name: "prompt", req: createRequest{VideoStorageKey: "video:1", CoverStorageKey: "image:1", Title: "demo", RecipeType: "prompt", RecipeContent: "a tracking shot"}, ok: true},
		{name: "skill", req: createRequest{VideoStorageKey: "video:1", CoverStorageKey: "image:1", Title: "demo", RecipeType: "skill", RecipeContent: "# Skill"}, ok: true},
		{name: "missing video", req: createRequest{Title: "demo", RecipeType: "prompt", RecipeContent: "text"}},
		{name: "bad type", req: createRequest{VideoStorageKey: "video:1", CoverStorageKey: "image:1", Title: "demo", RecipeType: "script", RecipeContent: "text"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validateCreateRequest(tt.req); (got == "") != tt.ok {
				t.Fatalf("validateCreateRequest() = %q, ok want %v", got, tt.ok)
			}
		})
	}
}

func TestNormalizeCreateRequestCanvasSnapshot(t *testing.T) {
	tests := []struct {
		name string
		raw  json.RawMessage
		has  bool
	}{
		{name: "missing", raw: nil},
		{name: "json null", raw: json.RawMessage("null")},
		{name: "spaced null", raw: json.RawMessage("  null  ")},
		{name: "project", raw: json.RawMessage(`{"nodes":[]}`), has: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := createRequest{CanvasSnapshot: tt.raw}
			normalizeCreateRequest(&req)
			if got := hasCanvasSnapshot(req.CanvasSnapshot); got != tt.has {
				t.Fatalf("hasCanvasSnapshot() = %v, want %v", got, tt.has)
			}
		})
	}
}

func TestSnapshotHasStorageKey(t *testing.T) {
	snapshot := []byte(`{"nodes":[{"metadata":{"storageKey":"image:cover-1","references":["video:clip-1"]}}]}`)
	tests := []struct {
		key  string
		want bool
	}{
		{key: "image:cover-1", want: true},
		{key: "video:clip-1", want: true},
		{key: "image:missing", want: false},
		{key: "ordinary text", want: false},
	}
	for _, tt := range tests {
		if got := snapshotHasStorageKey(snapshot, tt.key); got != tt.want {
			t.Errorf("snapshotHasStorageKey(%q) = %v, want %v", tt.key, got, tt.want)
		}
	}
}
