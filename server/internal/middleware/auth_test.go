package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/auth"
)

func init() { gin.SetMode(gin.TestMode) }

func testMgr() *auth.Manager {
	return auth.NewManager([]byte("test-secret-32-bytes-aaaaaaaaaaaa"), time.Hour, time.Hour)
}

func runWith(mw gin.HandlerFunc, setup func(*http.Request)) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := gin.New()
	r.Use(mw)
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"uid": UserIDFrom(c), "role": RoleFrom(c)})
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if setup != nil {
		setup(req)
	}
	r.ServeHTTP(w, req)
	return w
}

func TestRequireAuthMissingHeader(t *testing.T) {
	w := runWith(RequireAuth(testMgr()), nil)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("code = %d, want 401", w.Code)
	}
}

func TestRequireAuthValidAccess(t *testing.T) {
	mgr := testMgr()
	tok, _ := mgr.IssueAccess("u1", "user")
	w := runWith(RequireAuth(mgr), func(r *http.Request) {
		r.Header.Set("Authorization", "Bearer "+tok)
	})
	if w.Code != http.StatusOK {
		t.Errorf("code = %d, want 200; body=%s", w.Code, w.Body.String())
	}
}

func TestRequireAuthRejectsRefreshToken(t *testing.T) {
	mgr := testMgr()
	tok, _ := mgr.IssueRefresh("u1", "user")
	w := runWith(RequireAuth(mgr), func(r *http.Request) {
		r.Header.Set("Authorization", "Bearer "+tok)
	})
	if w.Code != http.StatusUnauthorized {
		t.Errorf("code = %d, want 401 (refresh token must not authorize)", w.Code)
	}
}

func TestRequireAuthFlexibleGoogHeader(t *testing.T) {
	mgr := testMgr()
	tok, _ := mgr.IssueAccess("u2", "user")
	w := runWith(RequireAuthFlexible(mgr), func(r *http.Request) {
		r.Header.Set("x-goog-api-key", tok)
	})
	if w.Code != http.StatusOK {
		t.Errorf("code = %d, want 200 (x-goog-api-key fallback)", w.Code)
	}
}

func TestRequireAdminForbidsNonAdmin(t *testing.T) {
	w := httptest.NewRecorder()
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(ctxRole, "user"); c.Next() }, RequireAdmin())
	r.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if w.Code != http.StatusForbidden {
		t.Errorf("code = %d, want 403", w.Code)
	}
}

func TestRequireAdminAllowsOperator(t *testing.T) {
	w := httptest.NewRecorder()
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(ctxRole, "operator"); c.Next() }, RequireAdmin())
	r.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if w.Code != http.StatusOK {
		t.Errorf("code = %d, want 200", w.Code)
	}
}

func TestRequireSuperAdminForbidsOperator(t *testing.T) {
	w := httptest.NewRecorder()
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(ctxRole, "operator"); c.Next() }, RequireSuperAdmin())
	r.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if w.Code != http.StatusForbidden {
		t.Errorf("code = %d, want 403", w.Code)
	}
}

func TestRequireAdminConfirmation(t *testing.T) {
	w := httptest.NewRecorder()
	r := gin.New()
	r.Use(RequireAdminConfirmation())
	r.DELETE("/", func(c *gin.Context) { c.Status(http.StatusOK) })
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("code = %d, want 400", w.Code)
	}
}
