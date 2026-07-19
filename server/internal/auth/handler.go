package auth

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
)

// Handler 提供 /auth/* 路由：register / login / refresh / me。
type Handler struct {
	store              *Store
	mgr                *Manager
	allowRegistration  bool
	grantCredits       int64
	granter            CreditGranter
	policy             RegistrationPolicy
	verification       EmailVerificationOptions
	verificationSender VerificationSender
	verificationPolicy EmailVerificationPolicy
	loginGuard         *LoginGuard
}

// CreditGranter 用于注册时给新用户赠送初始积分（credits 包实现）。
type CreditGranter interface {
	Grant(ctx context.Context, userID string, amount int64, reason, note string) (int64, error)
}

type RegistrationPolicy interface {
	RegistrationPolicy(ctx context.Context) (allow bool, grantCredits int64, err error)
}

type EmailVerificationPolicy interface {
	EmailVerificationEnabled(ctx context.Context) (bool, error)
}

func NewHandler(store *Store, mgr *Manager, allowRegistration bool, grantCredits int64, granter CreditGranter) *Handler {
	return &Handler{
		store:             store,
		mgr:               mgr,
		allowRegistration: allowRegistration,
		grantCredits:      grantCredits,
		granter:           granter,
	}
}

func (h *Handler) SetRegistrationPolicy(policy RegistrationPolicy) { h.policy = policy }

// SetLoginGuard 注入登录防爆破守卫（连续失败锁定账号）。未设置时不做锁定。
func (h *Handler) SetLoginGuard(guard *LoginGuard) { h.loginGuard = guard }

func (h *Handler) SetEmailVerification(sender VerificationSender, policy EmailVerificationPolicy, options EmailVerificationOptions) {
	h.verificationSender = sender
	h.verificationPolicy = policy
	h.verification = options.normalized()
}

type credentials struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}

type tokenPair struct {
	Token        string `json:"token"`
	RefreshToken string `json:"refreshToken"`
	User         User   `json:"user"`
}

type verificationRequiredResponse struct {
	VerificationRequired bool   `json:"verificationRequired"`
	Email                string `json:"email"`
	ExpiresInSeconds     int64  `json:"expiresInSeconds"`
	ResendAfterSeconds   int64  `json:"resendAfterSeconds"`
	ChallengeToken       string `json:"challengeToken"`
}

func (h *Handler) Register(c *gin.Context) {
	userCount, err := h.store.CountUsers(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	firstUser := userCount == 0

	allowRegistration := h.allowRegistration
	grantCredits := h.grantCredits
	if h.policy != nil {
		var err error
		allowRegistration, grantCredits, err = h.policy.RegistrationPolicy(c.Request.Context())
		if err != nil {
			httpx.Internal(c, err)
			return
		}
	}
	if !firstUser && !allowRegistration {
		httpx.FailCode(c, http.StatusForbidden, "registration_disabled", "平台暂未开放注册")
		return
	}
	var req credentials
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "invalid body")
		return
	}
	email, emailOK := normalizeEmail(req.Email)
	if !emailOK {
		httpx.BadRequest(c, "email invalid")
		return
	}
	if msg := passwordStrengthError(req.Password); msg != "" {
		httpx.BadRequest(c, msg)
		return
	}
	req.Email = email
	hash, err := HashPassword(req.Password)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	// 第一个注册用户自动成为 admin
	role := "user"
	if firstUser {
		role = "admin"
	}
	name := req.DisplayName
	if name == "" {
		name = strings.Split(req.Email, "@")[0]
	}
	verificationEnabled := false
	if !firstUser {
		verificationEnabled, err = h.emailVerificationEnabled(c.Request.Context())
		if err != nil {
			httpx.Internal(c, err)
			return
		}
	}
	if verificationEnabled {
		code, challengeToken, err := h.newRegistrationChallenge(c.Request.Context(), req.Email, hash, name)
		if errors.Is(err, ErrEmailTaken) {
			httpx.Fail(c, http.StatusConflict, "email already registered")
			return
		}
		if err != nil {
			h.writeVerificationError(c, err)
			return
		}
		if h.deliverVerificationCode(c, req.Email, code) {
			return
		}
		h.respondVerificationRequired(c, req.Email, challengeToken)
		return
	}
	u, err := h.store.Create(c.Request.Context(), req.Email, hash, name, role, true)
	if errors.Is(err, ErrEmailTaken) {
		httpx.Fail(c, http.StatusConflict, "email already registered")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	h.grantRegistrationCredits(c.Request.Context(), &u, grantCredits)
	h.respondTokens(c, u)
}

func (h *Handler) Login(c *gin.Context) {
	var req credentials
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "invalid body")
		return
	}
	// 用规范化后的邮箱做锁定键，避免大小写/空格绕过计数。无法解析时退回原始输入。
	guardKey := req.Email
	if normalized, ok := normalizeEmail(req.Email); ok {
		guardKey = normalized
	}
	if locked, retryAfter := h.loginGuard.Locked(c.Request.Context(), guardKey); locked {
		httpx.FailCode(c, http.StatusTooManyRequests, "account_locked", lockMessage(retryAfter))
		return
	}
	u, hash, err := h.store.FindByEmail(c.Request.Context(), req.Email)
	if err != nil || !CheckPassword(hash, req.Password) {
		if locked, retryAfter := h.loginGuard.RecordFailure(c.Request.Context(), guardKey); locked {
			httpx.FailCode(c, http.StatusTooManyRequests, "account_locked", lockMessage(retryAfter))
			return
		}
		httpx.Unauthorized(c, "invalid email or password")
		return
	}
	if u.Disabled {
		httpx.Forbidden(c, "account disabled")
		return
	}
	if !u.EmailVerified {
		httpx.FailCode(c, http.StatusForbidden, "email_verification_required", "email verification required")
		return
	}
	// 登录成功清除失败计数与锁定标记。
	h.loginGuard.Reset(c.Request.Context(), guardKey)
	h.respondTokens(c, u)
}

type verifyEmailRequest struct {
	Email          string `json:"email"`
	Code           string `json:"code"`
	ChallengeToken string `json:"challengeToken"`
}

func (h *Handler) VerifyEmail(c *gin.Context) {
	var req verifyEmailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "invalid body")
		return
	}
	email, ok := normalizeEmail(req.Email)
	code := strings.TrimSpace(req.Code)
	if !ok || len(code) != verificationCodeDigits || len(strings.TrimSpace(req.ChallengeToken)) < 32 {
		httpx.BadRequest(c, "email or verification code invalid")
		return
	}
	for _, r := range code {
		if r < '0' || r > '9' {
			httpx.BadRequest(c, "email or verification code invalid")
			return
		}
	}
	u, err := h.store.CompleteRegistration(c.Request.Context(), email,
		hashChallengeToken(h.verification.Secret, email, req.ChallengeToken),
		hashVerificationCode(h.verification.Secret, email, code), h.verification.MaxAttempts)
	if err != nil {
		switch {
		case errors.Is(err, ErrVerificationExpired):
			httpx.FailCode(c, http.StatusGone, "verification_expired", "verification code expired")
		case errors.Is(err, ErrVerificationTooMany):
			httpx.FailCode(c, http.StatusTooManyRequests, "verification_attempts_exceeded", "too many verification attempts; request a new code")
		case errors.Is(err, ErrVerificationInvalid):
			httpx.FailCode(c, http.StatusBadRequest, "verification_invalid", "verification code invalid")
		default:
			httpx.Internal(c, err)
		}
		return
	}
	_, grantCredits, policyErr := h.registrationPolicy(c.Request.Context())
	if policyErr != nil {
		log.Printf("email verification grant policy: %v", policyErr)
		grantCredits = h.grantCredits
	}
	h.grantRegistrationCredits(c.Request.Context(), &u, grantCredits)
	h.respondTokens(c, u)
}

func (h *Handler) ResendVerification(c *gin.Context) {
	enabled, policyErr := h.emailVerificationEnabled(c.Request.Context())
	if policyErr != nil {
		httpx.Internal(c, policyErr)
		return
	}
	if !enabled {
		httpx.NotFound(c, "email verification disabled")
		return
	}
	var req struct {
		Email          string `json:"email"`
		ChallengeToken string `json:"challengeToken"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "invalid body")
		return
	}
	email, ok := normalizeEmail(req.Email)
	if !ok {
		httpx.BadRequest(c, "email invalid")
		return
	}
	if len(strings.TrimSpace(req.ChallengeToken)) < 32 {
		httpx.BadRequest(c, "challenge invalid")
		return
	}
	code, err := generateVerificationCode()
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	err = h.store.ResendRegistrationChallenge(c.Request.Context(), email,
		hashChallengeToken(h.verification.Secret, email, req.ChallengeToken),
		hashVerificationCode(h.verification.Secret, email, code),
		h.verification.CodeTTL, h.verification.ResendCooldown, h.verification.MaxSendsHour)
	if err != nil {
		h.writeVerificationError(c, err)
		return
	}
	if h.deliverVerificationCode(c, email, code) {
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"ok": true, "resendAfterSeconds": int64(h.verification.ResendCooldown.Seconds())})
}

type refreshReq struct {
	RefreshToken string `json:"refreshToken"`
}

func (h *Handler) Refresh(c *gin.Context) {
	var req refreshReq
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "invalid body")
		return
	}
	claims, err := h.mgr.Parse(req.RefreshToken)
	if err != nil || claims.Type != "refresh" {
		httpx.Unauthorized(c, "invalid refresh token")
		return
	}
	u, err := h.store.FindByID(c.Request.Context(), claims.UserID)
	if err != nil {
		httpx.Unauthorized(c, "user not found")
		return
	}
	if u.Disabled {
		httpx.Forbidden(c, "account disabled")
		return
	}
	if !u.EmailVerified {
		httpx.FailCode(c, http.StatusForbidden, "email_verification_required", "email verification required")
		return
	}
	if u.SessionVersion != claims.SessionVersion {
		httpx.Unauthorized(c, "session revoked")
		return
	}
	h.respondTokens(c, u)
}

func (h *Handler) Me(c *gin.Context, userID string) {
	u, err := h.store.FindByID(c.Request.Context(), userID)
	if err != nil {
		httpx.Unauthorized(c, "user not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": u})
}

func (h *Handler) Logout(c *gin.Context, userID string) {
	if err := h.store.RevokeSessions(c.Request.Context(), userID); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) respondTokens(c *gin.Context, u User) {
	access, err := h.mgr.IssueAccessForSession(u.ID, u.Role, u.SessionVersion)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	refresh, err := h.mgr.IssueRefreshForSession(u.ID, u.Role, u.SessionVersion)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, tokenPair{Token: access, RefreshToken: refresh, User: u})
}

func (h *Handler) registrationPolicy(ctx context.Context) (bool, int64, error) {
	if h.policy == nil {
		return h.allowRegistration, h.grantCredits, nil
	}
	return h.policy.RegistrationPolicy(ctx)
}

func (h *Handler) grantRegistrationCredits(ctx context.Context, u *User, amount int64) {
	if h.granter == nil || amount <= 0 {
		return
	}
	if balance, err := h.granter.Grant(ctx, u.ID, amount, "register", "注册赠送"); err == nil {
		u.Credits = balance
	}
}

func (h *Handler) emailVerificationEnabled(ctx context.Context) (bool, error) {
	if h.verificationPolicy != nil {
		return h.verificationPolicy.EmailVerificationEnabled(ctx)
	}
	return h.verification.Enabled, nil
}

func (h *Handler) newRegistrationChallenge(ctx context.Context, email, passwordHash, displayName string) (code, token string, err error) {
	code, err = generateVerificationCode()
	if err != nil {
		return "", "", err
	}
	token, err = generateChallengeToken()
	if err != nil {
		return "", "", err
	}
	err = h.store.CreateRegistrationChallenge(ctx, email, passwordHash, displayName,
		hashVerificationCode(h.verification.Secret, email, code),
		hashChallengeToken(h.verification.Secret, email, token),
		h.verification.CodeTTL, h.verification.ResendCooldown, h.verification.MaxSendsHour)
	return code, token, err
}

// deliverVerificationCode 返回 true 表示已经写出错误响应，调用方必须立即 return。
func (h *Handler) deliverVerificationCode(c *gin.Context, email, code string) bool {
	if h.verificationSender == nil || len(h.verification.Secret) < 16 {
		httpx.FailCode(c, http.StatusServiceUnavailable, "email_delivery_unavailable", "verification email service unavailable")
		return true
	}
	if err := h.verificationSender.SendVerificationCode(c.Request.Context(), email, code, h.verification.CodeTTL); err != nil {
		log.Printf("send verification email to %s failed: %v", email, err)
		httpx.FailCode(c, http.StatusServiceUnavailable, "email_delivery_failed", "verification email could not be delivered; please retry later")
		return true
	}
	return false
}

func (h *Handler) writeVerificationError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrVerificationCooldown):
		httpx.FailCode(c, http.StatusTooManyRequests, "verification_cooldown", "verification email sent recently; please wait")
	case errors.Is(err, ErrVerificationSendLimit):
		httpx.FailCode(c, http.StatusTooManyRequests, "verification_send_limit", "verification email hourly limit reached")
	case errors.Is(err, ErrVerificationInvalid):
		httpx.FailCode(c, http.StatusBadRequest, "verification_invalid", "verification challenge invalid")
	default:
		httpx.Internal(c, err)
	}
}

func (h *Handler) respondVerificationRequired(c *gin.Context, email, challengeToken string) {
	c.JSON(http.StatusAccepted, verificationRequiredResponse{
		VerificationRequired: true,
		Email:                email,
		ExpiresInSeconds:     int64(h.verification.CodeTTL.Seconds()),
		ResendAfterSeconds:   int64(h.verification.ResendCooldown.Seconds()),
		ChallengeToken:       challengeToken,
	})
}
