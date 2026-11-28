import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarClock,
  Check,
  ChevronDown,
  Copy,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Mic,
  Plus,
  Settings,
  Trash2,
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
  const [switcherOpen, setSwitcherOpen] = useState(false);

  /** 解散小组：不可恢复，所以两次确认 */
  const disbandGroup = async () => {
    if (!group) return;
    setSwitcherOpen(false);
    if (!window.confirm(`确定要解散「${group.name}」吗？\n\n小组内所有任务、文件、会议纪要、贡献记录都会被永久删除，无法恢复。`)) {
      return;
    }
    if (!window.confirm(`最后确认：真的要解散「${group.name}」吗？`)) return;
    try {
      await api(`/api/groups/${group.id}`, { method: "DELETE" });
      queryClient.clear();
      toast.push(`「${group.name}」已解散`, "success");
      navigate("/onboarding", { replace: true });
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "解散失败，请重试", "error");
    }
  };

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

  /** 小组切换面板：桌面侧边栏和移动端头部共用同一份 */
  const switcherPanel = (
    <div className="overflow-hidden rounded-xl bg-slate-800 shadow-2xl ring-1 ring-white/10">
      <p className="px-3 pt-2 pb-1 text-[10px] tracking-wide text-slate-500">我的小组</p>
      {groups?.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => {
            setSwitcherOpen(false);
            navigate(`/g/${item.id}/board`);
          }}
          className={cx(
            "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] transition-colors",
            item.id === groupId ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5",
          )}
        >
          <span className="truncate">{item.name}</span>
          <span className="shrink-0 text-[10px] text-slate-500">
            {item.myRole === "LEADER" ? "组长" : "组员"}
          </span>
        </button>
      ))}
      <Link
        to="/onboarding"
        onClick={() => setSwitcherOpen(false)}
        className="flex items-center gap-1.5 border-t border-white/10 px-3 py-2 text-[12px] text-brand-300 transition-colors hover:bg-white/5"
      >
        <Plus className="size-3.5" />
        加入或创建小组
      </Link>
      {group?.myRole === "LEADER" && (
        <button
          type="button"
          onClick={disbandGroup}
          className="flex w-full items-center gap-1.5 border-t border-white/10 px-3 py-2 text-left text-[12px] text-rose-300 transition-colors hover:bg-rose-500/10"
        >
          <Trash2 className="size-3.5" />
          解散「{group.name}」
        </button>
      )}
    </div>
  );

  return (    <div className="app-shell flex h-full bg-slate-50">
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

        <div className="relative mx-3 mb-2">
          <button
            type="button"
            onClick={() => setSwitcherOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-left ring-1 ring-white/10 transition-colors hover:bg-white/[0.08]"
          >
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-white" title={group?.name}>
                {group?.name ?? "加载中…"}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                {group?.course || "未填写课程"} · {group?.memberCount ?? 0} 人
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-slate-400" />
          </button>

          {switcherOpen && (
            <div className="absolute inset-x-0 top-full z-30 mt-1">{switcherPanel}</div>
          )}
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
          <div className="relative flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSwitcherOpen((open) => !open)}
              className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left active:bg-slate-100"
              title="切换或加入小组"
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-xs font-bold text-white">
                战
              </div>
              <div className="min-w-0 leading-tight">
                <p className="flex items-center gap-1 truncate text-[13px] font-semibold text-slate-900">
                  <span className="truncate">{group?.name ?? "作战室"}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
                </p>
                <p className="truncate text-[10px] text-slate-500">
                  {group?.memberCount ?? 0} 人 · 邀请码 {group?.inviteCode ?? "······"}
                </p>
              </div>
            </button>
            {switcherOpen && (
              <div className="absolute top-full left-0 z-40 mt-2 w-72">{switcherPanel}</div>
            )}
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
