import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { groupsQuery, meQuery } from "./lib/queries.ts";
import AppShell from "./components/AppShell.tsx";
import BoardPage from "./pages/BoardPage.tsx";
import ComingSoonPage from "./pages/ComingSoonPage.tsx";
import ContributionsPage from "./pages/ContributionsPage.tsx";
import DdlPage from "./pages/DdlPage.tsx";
import FilesPage from "./pages/FilesPage.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import MinutesPage from "./pages/MinutesPage.tsx";
import SettingsPage from "./pages/SettingsPage.tsx";
import OnboardingPage from "./pages/OnboardingPage.tsx";
import RegisterPage from "./pages/RegisterPage.tsx";

function Splash({ label = "正在进入作战室…" }: { label?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-50">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white">
        战
      </div>
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, isLoading } = useQuery(meQuery());
  if (isLoading) return <Splash />;
  if (!data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** 首页分流：已登录且有小组 -> 看板；有账号没小组 -> 引导页 */
function HomeRedirect() {
  const { data: user, isLoading } = useQuery(meQuery());
  const { data: groups, isLoading: groupsLoading } = useQuery({
    ...groupsQuery(),
    enabled: Boolean(user),
  });

  if (isLoading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  if (groupsLoading) return <Splash label="正在加载小组…" />;

  const first = groups?.[0];
  return <Navigate to={first ? `/g/${first.id}/board` : "/onboarding"} replace />;
}

/** 组内布局：侧边栏常驻 + 子路由（五个模块共用） */
function GroupLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <OnboardingPage />
          </RequireAuth>
        }
      />
      <Route
        path="/g/:groupId"
        element={
          <RequireAuth>
            <GroupLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="board" replace />} />
        <Route path="board" element={<BoardPage />} />
        <Route path="ddl" element={<DdlPage />} />
        <Route path="files" element={<FilesPage />} />
        <Route path="contrib" element={<ContributionsPage />} />
        <Route path="minutes" element={<MinutesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
