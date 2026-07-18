package proxy

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

func TestFailoverTransportRetriesAndPreservesBody(t *testing.T) {
	body := []byte(`{"model":"shared-model","prompt":"hello"}`)
	primaryCalls := 0
	fallbackCalls := 0
	base := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		got, _ := io.ReadAll(r.Body)
		if !bytes.Equal(got, body) {
			t.Errorf("request body = %q", got)
		}
		if r.URL.Host == "primary.example" {
			primaryCalls++
			return &http.Response{StatusCode: http.StatusServiceUnavailable, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("unavailable")), Request: r}, nil
		}
		fallbackCalls++
		if got := r.Header.Get("Authorization"); got != "Bearer fallback-key" {
			t.Errorf("fallback authorization = %q", got)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"ok":true}`)), Request: r}, nil
	})

	state := &failoverAttemptState{}
	transport := &failoverTransport{
		Base: base,
		Candidates: []Channel{
			{ID: "primary", BaseURL: "https://primary.example", APIKey: "primary-key", APIFormat: "openai"},
			{ID: "fallback", BaseURL: "https://fallback.example", APIKey: "fallback-key", APIFormat: "openai"},
		},
		UpstreamPath: "/v1/images/generations",
		RequestBody:  body,
		State:        state,
	}
	request := httptest.NewRequest(http.MethodPost, "http://internal/api", bytes.NewReader(body))
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || primaryCalls != 1 || fallbackCalls != 1 {
		t.Fatalf("status=%d primary=%d fallback=%d", response.StatusCode, primaryCalls, fallbackCalls)
	}
	if state.SelectedChannelID != "fallback" || len(state.AttemptedChannels) != 2 || len(state.Failures) != 1 || state.Failures[0].ChannelID != "primary" {
		t.Fatalf("state = %#v", state)
	}
}

func TestFailoverTransportDoesNotRetryBadRequest(t *testing.T) {
	fallbackCalls := 0
	base := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "fallback.example" {
			fallbackCalls++
		}
		return &http.Response{StatusCode: http.StatusBadRequest, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("bad request")), Request: r}, nil
	})
	transport := &failoverTransport{Base: base, Candidates: []Channel{{ID: "primary", BaseURL: "https://primary.example"}, {ID: "fallback", BaseURL: "https://fallback.example"}}, UpstreamPath: "/v1/images/generations"}
	response, err := transport.RoundTrip(httptest.NewRequest(http.MethodPost, "http://internal/api", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest || fallbackCalls != 0 {
		t.Fatalf("status=%d fallback=%d", response.StatusCode, fallbackCalls)
	}
}

func TestRetryableUpstreamStatus(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusRequestTimeout, http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout} {
		if !retryableUpstreamStatus(status) {
			t.Errorf("status %d should be retryable", status)
		}
	}
	for _, status := range []int{http.StatusBadRequest, http.StatusNotFound, http.StatusUnprocessableEntity} {
		if retryableUpstreamStatus(status) {
			t.Errorf("status %d should not be retryable", status)
		}
	}
}
