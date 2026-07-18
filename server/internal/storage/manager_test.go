package storage

import "testing"

func TestStoragePrefixRoutesMediaFolders(t *testing.T) {
	settings := resolvedSettings{RuntimeDefaults: RuntimeDefaults{
		ImagePathPrefix: "image",
		VideoPathPrefix: "Video",
	}}
	tests := map[string]string{
		"image":           "image",
		"contest-cover":   "image",
		"video":           "Video",
		"video-reference": "Video",
		"contest-video":   "Video",
		"audio":           "",
		"file":            "",
	}
	for kind, want := range tests {
		if got := storagePrefix(settings, kind); got != want {
			t.Fatalf("storagePrefix(%q) = %q, want %q", kind, got, want)
		}
	}
}

func TestStoragePrefixKeepsFolderCaseAndAddsRoot(t *testing.T) {
	settings := resolvedSettings{RuntimeDefaults: RuntimeDefaults{
		PathPrefix:      "production",
		ImagePathPrefix: "image",
		VideoPathPrefix: "Video",
	}}
	if got := storagePrefix(settings, "image"); got != "production/image" {
		t.Fatalf("image prefix = %q", got)
	}
	if got := storagePrefix(settings, "video"); got != "production/Video" {
		t.Fatalf("video prefix = %q", got)
	}
}

func TestNormalizeResolvedDefaultsMediaFolders(t *testing.T) {
	settings, err := normalizeResolved(resolvedSettings{})
	if err != nil {
		t.Fatal(err)
	}
	if settings.ImagePathPrefix != "image" || settings.VideoPathPrefix != "Video" {
		t.Fatalf("unexpected media folders: image=%q video=%q", settings.ImagePathPrefix, settings.VideoPathPrefix)
	}
}
