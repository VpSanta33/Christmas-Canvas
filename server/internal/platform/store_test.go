package platform

import "testing"

func TestNormalizeSettings(t *testing.T) {
	settings := normalizeSettings(Settings{})
	if settings.SiteName != "圣诞画布" || settings.LogoURL != "/logo.svg" {
		t.Fatalf("defaults not restored: %#v", settings)
	}
}

func TestNormalizeAnnouncementSettings(t *testing.T) {
	settings := normalizeAnnouncementSettings(AnnouncementSettings{
		Announcement:      "  新功能已上线  ",
		MaintenanceNotice: "  周日维护  ",
	})
	if settings.Announcement != "新功能已上线" || settings.MaintenanceNotice != "周日维护" {
		t.Fatalf("announcement text not normalized: %#v", settings)
	}
}

func TestNormalizeSiteSettingsKeepsIndependentFields(t *testing.T) {
	settings := normalizeSiteSettings(SiteSettings{SiteName: " 画布站 ", LogoURL: " /brand.svg "})
	if settings.SiteName != "画布站" || settings.LogoURL != "/brand.svg" {
		t.Fatalf("site settings not normalized: %#v", settings)
	}
}

func TestApplyFirstUserDefaultsAllowsBootstrap(t *testing.T) {
	settings := applyFirstUserDefaults(PublicSettings{
		AllowRegistration:         false,
		EmailVerificationRequired: true,
	})
	if !settings.AllowRegistration || settings.EmailVerificationRequired {
		t.Fatalf("first user defaults not applied: %#v", settings)
	}
}
