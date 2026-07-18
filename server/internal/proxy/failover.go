package proxy

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// failoverAttemptState 记录最终实际使用的渠道，供用量日志与排障响应头使用。
type failoverAttemptState struct {
	SelectedChannelID string
	AttemptedChannels []string
	Failures          []failoverFailure
}

type failoverFailure struct {
	ChannelID  string
	HTTPStatus int
	Message    string
}

// failoverTransport 在 RoundTrip 层切换渠道，因此 ReverseProxy 仍可流式转发最终响应。
// 仅调用方提供多个候选时重试；请求 body 由上层预先缓存，保证每次尝试内容一致。
type failoverTransport struct {
	Base         http.RoundTripper
	Candidates   []Channel
	UpstreamPath string
	RequestBody  []byte
	State        *failoverAttemptState
}

func (t *failoverTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	base := t.Base
	if base == nil {
		base = http.DefaultTransport
	}
	var lastErr error
	for index, channel := range t.Candidates {
		if t.State != nil {
			t.State.AttemptedChannels = append(t.State.AttemptedChannels, channel.ID)
			t.State.SelectedChannelID = channel.ID
		}
		next, err := candidateRequest(request, channel, t.UpstreamPath, t.RequestBody)
		if err != nil {
			lastErr = err
			t.recordFailure(channel.ID, 0, err.Error())
			continue
		}
		response, err := base.RoundTrip(next)
		if err != nil {
			lastErr = err
			t.recordFailure(channel.ID, 0, err.Error())
			continue
		}
		if index < len(t.Candidates)-1 && retryableUpstreamStatus(response.StatusCode) {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
			_ = response.Body.Close()
			lastErr = fmt.Errorf("channel %s returned HTTP %d", channel.ID, response.StatusCode)
			t.recordFailure(channel.ID, response.StatusCode, lastErr.Error())
			continue
		}
		return response, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no available upstream channel")
	}
	return nil, lastErr
}

func (t *failoverTransport) recordFailure(channelID string, status int, message string) {
	if t.State == nil {
		return
	}
	t.State.Failures = append(t.State.Failures, failoverFailure{ChannelID: channelID, HTTPStatus: status, Message: message})
}

func candidateRequest(request *http.Request, channel Channel, upstreamPath string, body []byte) (*http.Request, error) {
	target, err := url.Parse(strings.TrimRight(channel.BaseURL, "/"))
	if err != nil || target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("bad channel base url for %s", channel.ID)
	}
	next := request.Clone(request.Context())
	next.Header = request.Header.Clone()
	next.URL.Scheme = target.Scheme
	next.URL.Host = target.Host
	next.URL.Path = singleJoin(target.Path, upstreamPath)
	next.URL.RawPath = ""
	next.Host = target.Host
	next.Header.Del("Authorization")
	next.Header.Del("x-goog-api-key")
	if channel.APIFormat == "gemini" {
		next.Header.Set("x-goog-api-key", channel.APIKey)
	} else {
		next.Header.Set("Authorization", "Bearer "+channel.APIKey)
	}
	if request.Body != nil || len(body) > 0 {
		next.Body = io.NopCloser(bytes.NewReader(body))
		next.ContentLength = int64(len(body))
	}
	return next, nil
}

func retryableUpstreamStatus(status int) bool {
	return status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500
}
