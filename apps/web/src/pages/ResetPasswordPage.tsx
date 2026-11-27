import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout.tsx";
import { Button, Field, Input } from "../components/ui.tsx";
import { api, errorMessage } from "../lib/api.ts";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const sendMutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; expiresIn: number }>("/api/auth/email-code", {
        body: { email: email.trim(), purpose: "RESET" },
      }),
    onSuccess: (data) => {
      setError(null);
      setNotice(`验证码已发送（如果该邮箱已注册），${Math.round(data.expiresIn / 60)} 分钟内有效`);
      setCountdown(60);
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  const resetMutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; message: string }>("/api/auth/reset-password", {
        body: { email: email.trim(), code: code.trim(), password },
      }),
    onSuccess: (data) => {
      setError(null);
      setNotice(data.message);
      setTimeout(() => navigate("/login", { replace: true }), 1200);
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    resetMutation.mutate();
  };

  return (
    <AuthLayout title="重置密码" subtitle="用邮箱验证码验证身份，然后设置新密码">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="注册邮箱">
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

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

        <Field label="新密码" hint="至少 6 位">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="设置新密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={6}
            required
          />
        </Field>
        <Field label="确认新密码">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="再输入一次"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
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

        <Button type="submit" className="w-full" loading={resetMutation.isPending}>
          重置密码
        </Button>
      </form>

      <div className="mt-4 flex items-center justify-between text-[13px] text-slate-500">
        <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
          返回登录
        </Link>
        <Link to="/register" className="hover:text-brand-600">
          注册新账号
        </Link>
      </div>
    </AuthLayout>
  );
}
