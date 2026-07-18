package proxy

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"net/url"
	"strconv"
	"strings"
)

type GenerationPricing struct {
	ImageQuality map[string]float64            `json:"imageQuality"`
	VideoPrices  map[string]map[string]float64 `json:"videoPrices"`
}

func defaultGenerationPricing() GenerationPricing {
	video := map[string]map[string]float64{}
	for _, quality := range []string{"480", "720", "1080"} {
		video[quality] = map[string]float64{}
		for seconds := 1; seconds <= 15; seconds++ {
			video[quality][strconv.Itoa(seconds)] = 0
		}
	}
	return GenerationPricing{
		ImageQuality: map[string]float64{"auto": 0, "low": 0, "medium": 0, "high": 0},
		VideoPrices:  video,
	}
}

func normalizeGenerationPricing(value GenerationPricing) GenerationPricing {
	defaults := defaultGenerationPricing()
	return GenerationPricing{
		ImageQuality: normalizePointMap(value.ImageQuality, defaults.ImageQuality),
		VideoPrices:  normalizeVideoPriceMap(value.VideoPrices, defaults.VideoPrices),
	}
}

func generationPricingForModel(model ChannelModel, fallback GenerationPricing) GenerationPricing {
	if model.GenerationPricing == nil {
		return normalizeGenerationPricing(fallback)
	}
	return normalizeGenerationPricing(*model.GenerationPricing)
}

func normalizePointMap(values, defaults map[string]float64) map[string]float64 {
	if values == nil {
		values = defaults
	}
	out := make(map[string]float64, len(values))
	for key, value := range values {
		key = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(key)), "p")
		if key == "" || math.IsNaN(value) || math.IsInf(value, 0) {
			continue
		}
		out[key] = math.Max(0, math.Min(1_000_000, value))
	}
	return out
}

func normalizeVideoPriceMap(values, defaults map[string]map[string]float64) map[string]map[string]float64 {
	if values == nil {
		values = defaults
	}
	out := make(map[string]map[string]float64, len(values))
	for quality, prices := range values {
		quality = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(quality)), "p")
		if quality == "" {
			continue
		}
		normalized := make(map[string]float64, 15)
		for seconds := 1; seconds <= 15; seconds++ {
			key := strconv.Itoa(seconds)
			normalized[key] = 0
			if value, ok := prices[key]; ok && !math.IsNaN(value) && !math.IsInf(value, 0) {
				normalized[key] = math.Max(0, math.Min(1_000_000, value))
			}
		}
		out[quality] = normalized
	}
	return out
}

// generationCost 以服务端收到的参数为准：模型基础积分 + 明确参数积分。
func generationCost(baseCost int64, capability string, body []byte, contentType string, pricing GenerationPricing) int64 {
	fields := extractBillingFields(body, contentType)
	switch capability {
	case "image":
		units := clampInt(parseInt(fields["n"], 1), 1, 1000)
		points := pointFor(pricing.ImageQuality, normalizeImageQuality(fields))
		return int64(math.Ceil((float64(max64(baseCost, 0)) + points) * float64(units)))
	case "video":
		points := videoPoints(pricing.VideoPrices, normalizeVideoQuality(fields), normalizeVideoSeconds(fields))
		return int64(math.Ceil(float64(max64(baseCost, 0)) + points))
	default:
		return max64(baseCost, 0)
	}
}

func pointFor(values map[string]float64, key string) float64 {
	if value, ok := values[key]; ok && !math.IsNaN(value) && !math.IsInf(value, 0) {
		return math.Max(0, value)
	}
	return 0
}

func videoPoints(values map[string]map[string]float64, quality, seconds string) float64 {
	prices := values[quality]
	if prices == nil {
		prices = values["720"]
	}
	if prices == nil {
		// 管理员可以删除 720p。未知分辨率不能因此落到 0，按全表最高参数积分计费。
		return highestVideoPoint(values)
	}
	if value, ok := prices[seconds]; ok {
		return math.Max(0, value)
	}
	// 未配置的恶意/过期参数按该分辨率最高价格计费，避免绕过后台价格表。
	max := 0.0
	for _, value := range prices {
		if value > max && !math.IsNaN(value) && !math.IsInf(value, 0) {
			max = value
		}
	}
	return max
}

func highestVideoPoint(values map[string]map[string]float64) float64 {
	max := 0.0
	for _, prices := range values {
		for _, value := range prices {
			if value > max && !math.IsNaN(value) && !math.IsInf(value, 0) {
				max = value
			}
		}
	}
	return max
}

func extractBillingFields(body []byte, contentType string) map[string]string {
	fields := map[string]string{}
	var payload map[string]any
	if json.Unmarshal(body, &payload) == nil {
		for _, key := range []string{"n", "quality", "resolution_name", "resolution", "vquality", "seconds", "duration"} {
			if value, ok := scalarString(payload[key]); ok {
				fields[key] = value
			}
		}
		if config, ok := objectValue(payload["generationConfig"]); ok {
			if responseFormat, ok := objectValue(config["responseFormat"]); ok {
				if image, ok := objectValue(responseFormat["image"]); ok {
					if value, ok := scalarString(image["imageSize"]); ok {
						fields["image_size"] = value
					}
				}
			}
		}
		return fields
	}
	mediaType, params, _ := mime.ParseMediaType(contentType)
	switch mediaType {
	case "multipart/form-data":
		reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				break
			}
			name := part.FormName()
			if billingField(name) {
				value, _ := io.ReadAll(io.LimitReader(part, 4096))
				fields[name] = strings.TrimSpace(string(value))
			}
			_ = part.Close()
		}
	case "application/x-www-form-urlencoded":
		if values, err := url.ParseQuery(string(body)); err == nil {
			for key := range values {
				if billingField(key) {
					fields[key] = values.Get(key)
				}
			}
		}
	}
	return fields
}

func billingField(key string) bool {
	switch key {
	case "n", "quality", "resolution_name", "resolution", "vquality", "seconds", "duration":
		return true
	default:
		return false
	}
}

func normalizeImageQuality(fields map[string]string) string {
	quality := strings.ToLower(strings.TrimSpace(fields["quality"]))
	if quality == "hd" {
		return "high"
	}
	if quality == "standard" {
		return "medium"
	}
	if quality == "" {
		switch strings.ToUpper(strings.TrimSpace(fields["image_size"])) {
		case "1K", "512":
			return "low"
		case "2K":
			return "medium"
		case "4K":
			return "high"
		default:
			return "auto"
		}
	}
	return quality
}

func normalizeVideoQuality(fields map[string]string) string {
	value := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(firstField(fields, "resolution_name", "resolution", "quality", "vquality"))), "p")
	switch value {
	case "low":
		return "480"
	case "", "auto", "medium", "high":
		return "720"
	default:
		return value
	}
}

func normalizeVideoSeconds(fields map[string]string) string {
	value := firstField(fields, "duration", "seconds")
	seconds, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return "6"
	}
	return strconv.Itoa(seconds)
}

func firstField(fields map[string]string, keys ...string) string {
	for _, key := range keys {
		if fields[key] != "" {
			return fields[key]
		}
	}
	return ""
}
func scalarString(value any) (string, bool) {
	switch typed := value.(type) {
	case string:
		return typed, true
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64), true
	default:
		return "", false
	}
}
func objectValue(value any) (map[string]any, bool) {
	object, ok := value.(map[string]any)
	return object, ok
}
func parseInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}
func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
func max64(value, min int64) int64 {
	if value < min {
		return min
	}
	return value
}
