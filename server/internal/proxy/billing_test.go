package proxy

import (
	"bytes"
	"mime/multipart"
	"testing"
)

func TestGenerationCostImageUsesExplicitPointsPerImage(t *testing.T) {
	pricing := defaultGenerationPricing()
	pricing.ImageQuality["high"] = 5
	body := []byte(`{"model":"image-model","quality":"high","n":2}`)
	if got := generationCost(10, "image", body, "application/json", pricing); got != 30 {
		t.Fatalf("generationCost image = %d, want 30", got)
	}
}

func TestGenerationCostVideoUsesExplicitQualityDurationPrice(t *testing.T) {
	pricing := defaultGenerationPricing()
	pricing.VideoPrices["1080"]["10"] = 20
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("resolution_name", "1080p")
	_ = writer.WriteField("seconds", "10")
	_ = writer.Close()
	if got := generationCost(10, "video", body.Bytes(), writer.FormDataContentType(), pricing); got != 30 {
		t.Fatalf("generationCost video = %d, want 30", got)
	}
}

func TestGenerationCostRoundsExplicitPointsUp(t *testing.T) {
	pricing := defaultGenerationPricing()
	pricing.ImageQuality["medium"] = 1.25
	if got := generationCost(3, "image", []byte(`{"quality":"medium"}`), "application/json", pricing); got != 5 {
		t.Fatalf("generationCost rounded = %d, want 5", got)
	}
}

func TestGenerationCostUnknownVideoDurationUsesHighestConfiguredPrice(t *testing.T) {
	pricing := defaultGenerationPricing()
	pricing.VideoPrices["480"] = map[string]float64{"5": 8, "15": 25}
	body := []byte(`{"resolution":"480p","seconds":999}`)
	if got := generationCost(10, "video", body, "application/json", pricing); got != 35 {
		t.Fatalf("generationCost unknown duration = %d, want 35", got)
	}
}

func TestGenerationCostUnknownVideoQualityWithout720UsesHighestConfiguredPrice(t *testing.T) {
	pricing := defaultGenerationPricing()
	pricing.VideoPrices = map[string]map[string]float64{"480": {"15": 25}}
	body := []byte(`{"resolution":"999p","seconds":15}`)
	if got := generationCost(10, "video", body, "application/json", pricing); got != 35 {
		t.Fatalf("generationCost unknown quality = %d, want 35", got)
	}
}

func TestNormalizeGenerationPricingPreservesAdminOptions(t *testing.T) {
	pricing := normalizeGenerationPricing(GenerationPricing{
		ImageQuality: map[string]float64{"HIGH": 3.5},
		VideoPrices:  map[string]map[string]float64{"480p": {"15": 22}},
	})
	if pricing.ImageQuality["high"] != 3.5 || pricing.VideoPrices["480"]["15"] != 22 {
		t.Fatalf("normalized pricing = %#v", pricing)
	}
	if _, exists := pricing.ImageQuality["auto"]; exists {
		t.Fatal("deleted admin option must not be restored")
	}
	if pricing.VideoPrices["480"]["2"] != 0 {
		t.Fatal("1-15 second pricing rows must always be available")
	}
	if _, exists := pricing.VideoPrices["480"]["20"]; exists {
		t.Fatal("video pricing above 15 seconds must be discarded")
	}
}

func TestGenerationPricingForModelOverridesFallback(t *testing.T) {
	fallback := defaultGenerationPricing()
	fallback.VideoPrices["480"]["15"] = 9
	independent := defaultGenerationPricing()
	independent.VideoPrices["480"]["15"] = 27

	got := generationPricingForModel(ChannelModel{GenerationPricing: &independent}, fallback)
	if got.VideoPrices["480"]["15"] != 27 {
		t.Fatalf("model pricing = %v, want 27", got.VideoPrices["480"]["15"])
	}
	got = generationPricingForModel(ChannelModel{}, fallback)
	if got.VideoPrices["480"]["15"] != 9 {
		t.Fatalf("fallback pricing = %v, want 9", got.VideoPrices["480"]["15"])
	}
}
