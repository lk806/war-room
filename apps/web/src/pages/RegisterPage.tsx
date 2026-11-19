import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@war-room/shared";
import { Link, Navigate, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout.tsx";
import { Button, Field, Input } from "../components/ui.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { meQuery } from "../lib/queries.ts";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery(meQuery());

  // 后端是否开启了邮箱验证（没配 SMTP 时自动退回老注册流程）
  const { data: codeStatus } = useQuery({
    queryKey: ["email-code-status"],
    queryFn: () => api<{ enabled: boolean; ttlMinutes: number }>("/api/auth/email-code/status"),
    staleTime: 5 * 60 * 1000,
  });
  const needCode = codeStatus?.enabled ?? false;

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const mutation = useMutation({
    mutationFn: (input: { name: string; email: string; password: string; code: string }) =>
      needCode
        ? api<{ user: User }>("/api/auth/register-with-code", { body: input })
        : api<{ user: User }>("/api/auth/register", {
            body: { name: input.name, email: input.email, password: input.password },
          }),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(["me"], user);
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      navigate("/onboarding", { replace: true });
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; expiresIn: number }>("/api/auth/email-code", {
        body: { email: email.trim(), purpose: "REGISTER" },
      }),
    onSuccess: (data) => {
      setError(null);
      setNotice(`验证码已发送到你的邮箱，${Math.round(data.expiresIn / 60)} 分钟内有效`);
      setCountdown(60);
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  if (currentUser) return <Navigate to="/" replace />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    mutation.mutate({ name: name.trim(), email: email.trim(), password, code: code.trim() });
  };

  return (
    <AuthLayout title="创建账号" subtitle="30 秒完成，然后建立或加入你的小组">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="昵称" hint="组员看到的名字">
          <Input
            placeholder="例如：林晓"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={24}
            required
          />
        </Field>
        <Field label="邮箱" hint={needCode ? "注册后需要验证邮箱" : undefined}>
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        {needCode && (
          <Field label="邮箱验证码" hint="点右侧按钮发送 6 位验证码">
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

        <Field label="密码" hint="至少 6 位">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="设置登录密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={6}
            required
          />
        </Field>

        {notice && (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">{notice}</p>
        )}
        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
        )}

        <Button type="submit" className="w-full" loading={mutation.isPending}>
          注册并继续
        </Button>
      </form>

      <div className="mt-4 flex items-center justify-between text-[13px]">
        <span className="text-slate-500">已经有账号？</span>
        <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
          去登录
        </Link>
      </div>
    </AuthLayout>
  );
}
