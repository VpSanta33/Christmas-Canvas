package platform

import "testing"

func TestNormalizeSettings(t *testing.T) {
	settings := normalizeSettings(Settings{RegisterGrantCredits: -1, AutoPauseFailures: 99})
	if settings.SiteName != "圣诞画布" || settings.LogoURL != "/logo.svg" {
		t.Fatalf("defaults not restored: %#v", settings)
	}
	if settings.RegisterGrantCredits != 0 || settings.AutoPauseFailures != 20 {
		t.Fatalf("limits not normalized: %#v", settings)
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
	settings := normalizeSiteSettings(SiteSettings{SiteName: " 画布站 ", LogoURL: " /brand.svg ", AutoPauseFailures: 1})
	if settings.SiteName != "画布站" || settings.LogoURL != "/brand.svg" || settings.AutoPauseFailures != 2 {
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
