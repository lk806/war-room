import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarClock,
  Check,
  Copy,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Mic,
  Plus,
  Settings,
  Users,
} from "lucide-react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.ts";
import { groupsQuery, meQuery } from "../lib/queries.ts";
import { useToast } from "../lib/toast.tsx";
import { Avatar, cx } from "./ui.tsx";

const NAV_ITEMS = [
  { key: "board", label: "任务看板", icon: LayoutDashboard },
  { key: "ddl", label: "DDL 管理", icon: CalendarClock },
  { key: "files", label: "文件区", icon: FolderOpen },
  { key: "contrib", label: "贡献记录", icon: BarChart3 },
  { key: "minutes", label: "会议纪要", icon: Mic },
  { key: "settings", label: "设置", icon: Settings },
] as const;

export default function AppShell({ children }: { children: ReactNode }) {
  const { groupId } = useParams<{ groupId: string }>();
  const { data: user } = useQuery(meQuery());
  const { data: groups } = useQuery(groupsQuery());
  const group = groups?.find((item) => item.id === groupId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copyInvite = async () => {
    if (!group) return;
    try {
      await navigator.clipboard.writeText(group.inviteCode);
      setCopied(true);
      toast.push("邀请码已复制，发给组员即可加入", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.push(`邀请码：${group.inviteCode}`, "info");
    }
  };

  const logout = async () => {
    // 退出接口失败（断网/会话已过期）也要把本地状态清掉并回登录页，
    // 否则按钮看起来「点了没反应」
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* 忽略：本地清理更重要 */
    } finally {
      queryClient.clear();
      navigate("/login", { replace: true });
    }
  };

  return (
    <div className="app-shell flex h-full bg-slate-50">
      {/* ------------------------ 桌面端侧边栏 ------------------------ */}
      <aside className="app-sidebar hidden w-60 shrink-0 flex-col bg-slate-900 lg:flex">
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-brand-500 text-base font-bold text-white shadow-lg shadow-brand-500/30">
            战
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">小组作业作战室</p>
            <p className="text-[11px] tracking-wide text-slate-400">WAR ROOM</p>
          </div>
        </div>

        <div className="mx-3 mb-2 rounded-xl bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
          <p className="truncate text-[13px] font-medium text-white" title={group?.name}>
            {group?.name ?? "加载中…"}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">
            {group?.course || "未填写课程"} · {group?.memberCount ?? 0} 人
          </p>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.key}
              to={`/g/${groupId}/${item.key}`}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={copyInvite}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-left text-[11px] text-slate-400 transition-colors hover:border-white/25 hover:text-slate-200"
          >
            <span>
              邀请码
              <span className="ml-1 font-mono text-[12px] tracking-widest text-white">
                {group?.inviteCode ?? "······"}
              </span>
            </span>
            {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          </button>
        </div>

        <div className="border-t border-white/10 px-3 py-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={user?.name ?? "?"} color={user?.avatarColor ?? "#6366f1"} size={30} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-medium text-white">{user?.name}</p>
              <p className="truncate text-[11px] text-slate-500">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              title="退出登录"
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ------------------------ 主区域 ------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-mobile-header sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-brand-500 text-xs font-bold text-white">
              战
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[13px] font-semibold text-slate-900">{group?.name ?? "作战室"}</p>
              <p className="truncate text-[10px] text-slate-500">
                {group?.memberCount ?? 0} 人 · 邀请码 {group?.inviteCode ?? "······"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={copyInvite}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 active:bg-slate-100"
            title="复制邀请码"
          >
            {copied ? <Check className="size-4 text-emerald-500" /> : <Users className="size-4" />}
          </button>
        </header>

        <main className="app-main flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>

        <nav className="app-bottom-nav sticky bottom-0 z-30 flex shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.key}
              to={`/g/${groupId}/${item.key}`}
              className={({ isActive }) =>
                cx(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors",
                  isActive ? "text-brand-600" : "text-slate-400",
                )
              }
            >
              <item.icon className="size-[18px]" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function InvitePill() {
  return (
    <Link
      to="/onboarding"
      className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-brand-600"
    >
      <Plus className="size-3.5" />
      邀请组员
    </Link>
  );
}
