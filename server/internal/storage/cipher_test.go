package storage

import (
	"bytes"
	"crypto/rand"
	"testing"
)

func newTestCipher(t *testing.T) *Cipher {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand key: %v", err)
	}
	c, err := NewCipher(key)
	if err != nil {
		t.Fatalf("new cipher: %v", err)
	}
	return c
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	c := newTestCipher(t)
	plain := []byte("sk-super-secret-channel-api-key")
	ct, err := c.Encrypt(plain)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if bytes.Contains(ct, plain) {
		t.Fatal("ciphertext must not contain plaintext")
	}
	got, err := c.Decrypt(ct)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(got, plain) {
		t.Errorf("round trip mismatch: got %q want %q", got, plain)
	}
}

func TestEncryptNonDeterministic(t *testing.T) {
	c := newTestCipher(t)
	plain := []byte("same-input")
	a, _ := c.Encrypt(plain)
	b, _ := c.Encrypt(plain)
	if bytes.Equal(a, b) {
		t.Fatal("two encryptions of the same plaintext must differ (random nonce)")
	}
}

func TestDecryptRejectsShort(t *testing.T) {
	c := newTestCipher(t)
	if _, err := c.Decrypt([]byte{0x01, 0x02}); err == nil {
		t.Fatal("expected error on too-short ciphertext")
	}
}

func TestDecryptRejectsTampered(t *testing.T) {
	c := newTestCipher(t)
	ct, _ := c.Encrypt([]byte("payload"))
	ct[len(ct)-1] ^= 0xff // flip a bit in the tag/ciphertext
	if _, err := c.Decrypt(ct); err == nil {
		t.Fatal("expected auth failure on tampered ciphertext")
	}
}

func TestNewCipherRejectsWrongKeySize(t *testing.T) {
	if _, err := NewCipher([]byte("too-short")); err == nil {
		t.Fatal("expected error for non-32-byte key")
	}
}
