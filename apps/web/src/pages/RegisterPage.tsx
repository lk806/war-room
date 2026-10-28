import { useState, type FormEvent } from "react";
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
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery(meQuery());

  const mutation = useMutation({
    mutationFn: (input: { name: string; email: string; password: string }) =>
      api<{ user: User }>("/api/auth/register", { body: input }),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(["me"], user);
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      navigate("/onboarding", { replace: true });
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  if (currentUser) return <Navigate to="/" replace />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    mutation.mutate({ name: name.trim(), email: email.trim(), password });
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
