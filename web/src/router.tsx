import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { RequireAdmin } from "@/components/layout/require-admin";
import { RequireAuth } from "@/components/layout/require-auth";
import { RequireSuperAdmin } from "@/components/layout/require-super-admin";
import AdminLayout from "@/layouts/admin-layout";
import UserLayout from "@/layouts/user-layout";
import AdminAnnouncementsPage from "@/pages/admin/announcements";
import AdminEmailPage from "@/pages/admin/email";
import AdminOverviewPage from "@/pages/admin/overview";
import AdminPlatformPage from "@/pages/admin/platform";
import AdminSecurityPage from "@/pages/admin/security";
import AdminStoragePage from "@/pages/admin/storage";
import AdminUsersPage from "@/pages/admin/users";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import WorkspacePage, { SharedCanvasPage } from "@/pages/workspace";
import VideoPage from "@/pages/video";

export const router = createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
    { path: "/shared/:token", element: <SharedCanvasPage /> },
    {
        element: (
            <RequireAuth>
                <UserLayout>
                    <AnalyticsTracker />
                    <Outlet />
                </UserLayout>
            </RequireAuth>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            {
                path: "/director",
                lazy: async () => ({ Component: (await import("@/pages/director")).default }),
            },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/tasks", element: <WorkspacePage initialTab="tasks" /> },
            { path: "/workspace", element: <WorkspacePage initialTab="tasks" /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
        ],
    },
    {
        element: (
            <RequireAdmin>
                <AdminLayout>
                    <Outlet />
                </AdminLayout>
            </RequireAdmin>
        ),
        children: [
            { path: "/admin", element: <AdminOverviewPage /> },
            {
                path: "/admin/users",
                element: (
                    <RequireSuperAdmin>
                        <AdminUsersPage />
                    </RequireSuperAdmin>
                ),
            },
            {
                path: "/admin/platform",
                element: (
                    <RequireSuperAdmin>
                        <AdminPlatformPage />
                    </RequireSuperAdmin>
                ),
            },
            {
                path: "/admin/announcements",
                element: (
                    <RequireSuperAdmin>
                        <AdminAnnouncementsPage />
                    </RequireSuperAdmin>
                ),
            },
            {
                path: "/admin/email",
                element: (
                    <RequireSuperAdmin>
                        <AdminEmailPage />
                    </RequireSuperAdmin>
                ),
            },
            {
                path: "/admin/security",
                element: (
                    <RequireSuperAdmin>
                        <AdminSecurityPage />
                    </RequireSuperAdmin>
                ),
            },
            {
                path: "/admin/storage",
                element: (
                    <RequireSuperAdmin>
                        <AdminStoragePage />
                    </RequireSuperAdmin>
                ),
            },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
