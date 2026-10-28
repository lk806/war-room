import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@war-room/shared";
import { Link, Navigate, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout.tsx";
import { Button, Field, Input } from "../components/ui.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { meQuery } from "../lib/queries.ts";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery(meQuery());

  const mutation = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<{ user: User }>("/api/auth/login", { body: input }),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(["me"], user);
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      navigate("/", { replace: true });
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  if (currentUser) return <Navigate to="/" replace />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    mutation.mutate({ email: email.trim(), password });
  };

  return (
    <AuthLayout title="登录作战室" subtitle="继续管理你的小组任务与进度">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="邮箱">
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="密码">
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="至少 6 位"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>

        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
        )}

        <Button type="submit" className="w-full" loading={mutation.isPending}>
          登录
        </Button>
      </form>

      <div className="mt-4 flex items-center justify-between text-[13px]">
        <span className="text-slate-500">还没有账号？</span>
        <Link to="/register" className="font-medium text-brand-600 hover:text-brand-700">
          注册一个
        </Link>
      </div>

      {/* 演示账号只在开发环境出现：生产构建里这段会被 Vite 按 DEV=false 剔除，
          避免任何人拿到演示账号密码后就多出一个可写入口 */}
      {import.meta.env.DEV && (
      <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-3">
        <p className="text-[12px] font-medium text-slate-600">演示账号（已预置 4 人小组与 10 个任务）</p>
        <p className="mt-1 font-mono text-[12px] text-slate-500">demo@war-room.local / demo1234</p>
        <button
          type="button"
          onClick={() => {
            setEmail("demo@war-room.local");
            setPassword("demo1234");
          }}
          className="mt-2 text-[12px] font-medium text-brand-600 hover:text-brand-700"
        >
          一键填入
        </button>
      </div>
      )}
    </AuthLayout>
  );
}
