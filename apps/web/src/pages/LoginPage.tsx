import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@war-room/shared";
import { Link, Navigate, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout.tsx";
import { Button, Field, Input } from "../components/ui.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { meQuery } from "../lib/queries.ts";

export default function LoginPage() {
  const [mode, setMode] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery(meQuery());

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const afterLogin = (user: User) => {
    queryClient.setQueryData(["me"], user);
    queryClient.invalidateQueries({ queryKey: ["groups"] });
    navigate("/", { replace: true });
  };

  const passwordMutation = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<{ user: User }>("/api/auth/login", { body: input }),
    onSuccess: ({ user }) => afterLogin(user),
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  const codeMutation = useMutation({
    mutationFn: (input: { email: string; code: string }) =>
      api<{ user: User }>("/api/auth/login-by-code", { body: input }),
    onSuccess: ({ user }) => afterLogin(user),
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; expiresIn: number }>("/api/auth/email-code", {
        body: { email: email.trim(), purpose: "LOGIN" },
      }),
    onSuccess: (data) => {
      setError(null);
      setNotice(`验证码已发送，${Math.round(data.expiresIn / 60)} 分钟内有效`);
      setCountdown(60);
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  if (currentUser) return <Navigate to="/" replace />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === "password") {
      passwordMutation.mutate({ email: email.trim(), password });
    } else {
      codeMutation.mutate({ email: email.trim(), code: code.trim() });
    }
  };

  return (
    <AuthLayout title="登录作战室" subtitle="继续管理你的小组任务与进度">
      <div className="mb-4 flex rounded-xl bg-slate-100 p-1 text-[13px]">
        {(
          [
            { key: "password", label: "密码登录" },
            { key: "code", label: "验证码登录" },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setMode(item.key);
              setError(null);
              setNotice(null);
            }}
            className={
              mode === item.key
                ? "flex-1 rounded-lg bg-white px-3 py-1.5 font-medium text-slate-900 shadow-sm"
                : "flex-1 rounded-lg px-3 py-1.5 text-slate-500 hover:text-slate-700"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

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
        {mode === "password" ? (
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
        ) : (
          <Field label="验证码">
            <div className="flex gap-2">
              <Input
                inputMode="numeric"
                placeholder="6 位数字"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                required
              />
              <Button
                type="button"
                variant="secondary"
                className="shrink-0 whitespace-nowrap"
                disabled={countdown > 0 || sendMutation.isPending || !email.trim()}
                loading={sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
              >
                {countdown > 0 ? `${countdown}s` : "获取验证码"}
              </Button>
            </div>
          </Field>
        )}

        {notice && (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">{notice}</p>
        )}

        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
        )}

        <Button
          type="submit"
          className="w-full"
          loading={passwordMutation.isPending || codeMutation.isPending}
        >
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
