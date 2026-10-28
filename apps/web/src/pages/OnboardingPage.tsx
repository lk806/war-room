import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Group } from "@war-room/shared";
import { ArrowRight, LogOut, PlusCircle, Ticket, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, Field, Input } from "../components/ui.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { groupsQuery } from "../lib/queries.ts";
import { useToast } from "../lib/toast.tsx";

export default function OnboardingPage() {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [course, setCourse] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: groups } = useQuery(groupsQuery());

  const onDone = (group: Group) => {
    queryClient.invalidateQueries({ queryKey: ["groups"] });
    toast.push(`已进入「${group.name}」`, "success");
    navigate(`/g/${group.id}/board`, { replace: true });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api<{ group: Group }>("/api/groups", { body: { name: name.trim(), course: course.trim() } }),
    onSuccess: ({ group }) => onDone(group),
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  const joinMutation = useMutation({
    mutationFn: () =>
      api<{ group: Group }>("/api/groups/join", {
        body: { inviteCode: inviteCode.trim().toUpperCase() },
      }),
    onSuccess: ({ group }) => onDone(group),
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

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

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    createMutation.mutate();
  };

  const onJoin = (event: FormEvent) => {
    event.preventDefault();
    joinMutation.mutate();
  };

  return (
    <div className="min-h-full bg-slate-50 px-5 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
                战
              </div>
              <span className="text-[13px] font-medium text-slate-500">小组作业作战室</span>
            </div>
            <h1 className="text-2xl font-semibold text-slate-900">先建立一个小组，或加入已有小组</h1>
            <p className="mt-1.5 text-[13px] text-slate-500">
              建立小组后你会成为组长，把 6 位邀请码发给组员即可把他们拉进来。
            </p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-1 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-700"
          >
            <LogOut className="size-3.5" />
            退出
          </button>
        </div>

        {groups && groups.length > 0 && (
          <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-[12px] font-medium text-slate-500">你已经加入的小组</p>
            <div className="space-y-1">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => navigate(`/g/${group.id}/board`)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-slate-800">
                      {group.name}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {group.course || "未填写课程"} · {group.memberCount} 人 ·{" "}
                      {group.myRole === "LEADER" ? "组长" : "成员"}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setMode("create")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              mode === "create" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <PlusCircle className="size-3.5" />
            新建小组
          </button>
          <button
            type="button"
            onClick={() => setMode("join")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              mode === "join" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Ticket className="size-3.5" />
            用邀请码加入
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {mode === "create" ? (
            <form onSubmit={onCreate} className="space-y-4">
              <Field label="小组名称" hint="例如：数据结构 · 课程设计第 3 组">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="给小组起个名字"
                  maxLength={40}
                  required
                />
              </Field>
              <Field label="课程名称" hint="选填">
                <Input
                  value={course}
                  onChange={(event) => setCourse(event.target.value)}
                  placeholder="例如：数据结构与算法"
                  maxLength={60}
                />
              </Field>
              <Button type="submit" loading={createMutation.isPending} className="w-full sm:w-auto">
                创建小组并进入
              </Button>
            </form>
          ) : (
            <form onSubmit={onJoin} className="space-y-4">
              <Field label="邀请码" hint="组长在侧边栏可以看到 6 位邀请码">
                <Input
                  value={inviteCode}
                  onChange={(event) =>
                    setInviteCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                  }
                  placeholder="例如：K7M2QP"
                  maxLength={6}
                  className="font-mono text-base tracking-[0.3em] uppercase"
                  required
                />
              </Field>
              <Button
                type="submit"
                loading={joinMutation.isPending}
                disabled={inviteCode.trim().length !== 6}
                className="w-full sm:w-auto"
              >
                加入小组
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 flex items-center gap-1.5 text-[12px] text-slate-400">
          <Users className="size-3.5" />
          小组成员共享同一个任务看板，所有变更实时同步。
        </p>
      </div>
    </div>
  );
}
