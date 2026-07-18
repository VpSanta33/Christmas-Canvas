package proxy

import (
	"bytes"
	"mime/multipart"
	"testing"
)

func TestSingleJoin(t *testing.T) {
	cases := []struct {
		base, path, want string
	}{
		{"https://api.example.com", "/v1/images/generations", "https://api.example.com/v1/images/generations"},
		{"https://api.example.com/", "/v1/chat", "https://api.example.com/v1/chat"},
		{"https://api.example.com/base/", "v1/chat", "https://api.example.com/base/v1/chat"},
		{"https://api.example.com", "", "https://api.example.com"},
		{"", "/v1/x", "/v1/x"},
	}
	for _, tc := range cases {
		if got := singleJoin(tc.base, tc.path); got != tc.want {
			t.Errorf("singleJoin(%q,%q) = %q, want %q", tc.base, tc.path, got, tc.want)
		}
	}
}

func TestExtractModel(t *testing.T) {
	if got := extractModel([]byte(`{"model":"gpt-image-2"}`), "application/json", "/v1/images/generations"); got != "gpt-image-2" {
		t.Fatalf("extractModel JSON = %q", got)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("model", "grok-imagine-video"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("prompt", "test"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if got := extractModel(body.Bytes(), writer.FormDataContentType(), "/v1/videos"); got != "grok-imagine-video" {
		t.Fatalf("extractModel multipart = %q", got)
	}

	if got := extractModel(nil, "application/json", "/v1beta/models/gemini-3-pro:generateContent"); got != "gemini-3-pro" {
		t.Fatalf("extractModel path = %q", got)
	}
}

func TestFindChannelModel(t *testing.T) {
	disabled := false
	models := []ChannelModel{
		{Name: "GPT-Image-2", Capability: "image", Cost: 8},
		{Name: "disabled-model", Capability: "image", Enabled: &disabled},
	}
	model, ok := findChannelModel(models, "gpt-image-2")
	if !ok || model.Cost != 8 || model.Capability != "image" {
		t.Fatalf("findChannelModel = %#v, %v", model, ok)
	}
	if _, ok := findChannelModel(models, "unconfigured-model"); ok {
		t.Fatal("unconfigured model must not match")
	}
	if _, ok := findChannelModel(models, "disabled-model"); ok {
		t.Fatal("disabled model must not match")
	}
}

func TestValidModelDefault(t *testing.T) {
	enabled := true
	disabled := false
	channels := []PublicChannel{
		{ID: "channel-a", Enabled: true, Models: []ChannelModel{
			{Name: "image-a", Capability: "image", Enabled: &enabled},
			{Name: "video-a", Capability: "video"},
			{Name: "offline-a", Capability: "image", Enabled: &disabled},
		}},
	}
	if !validModelDefault(channels, "channel-a::image-a", "image") {
		t.Fatal("enabled matching model should be a valid default")
	}
	if validModelDefault(channels, "channel-a::video-a", "image") {
		t.Fatal("capability mismatch must be rejected")
	}
	if validModelDefault(channels, "channel-a::offline-a", "image") {
		t.Fatal("disabled model must be rejected")
	}
	sanitized := sanitizeModelDefaults(channels, ModelDefaults{Image: "channel-a::offline-a", Video: "channel-a::video-a"})
	if sanitized.Image != "" || sanitized.Video != "channel-a::video-a" {
		t.Fatalf("sanitizeModelDefaults = %#v", sanitized)
	}
}

func TestCapabilityFromPath(t *testing.T) {
	cases := map[string]string{
		"/v1/images/generations":       "image",
		"/v1/videos/generations":       "video",
		"/v1beta/contents/generations": "video",
		"/v1/audio/speech":             "audio",
		"/v1/chat/completions":         "text",
		"/v1/models":                   "text",
	}
	for path, want := range cases {
		if got := capabilityFromPath(path); got != want {
			t.Errorf("capabilityFromPath(%q) = %q, want %q", path, got, want)
		}
	}
}
