import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  ChevronDown,
  ExternalLink,
  KeyRound,
  Lock,
  ShieldCheck,
} from "lucide-react";
import type { User } from "@war-room/shared";
import { Avatar, Button, Spinner, cx } from "../components/ui.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { aiStatusQuery, meQuery } from "../lib/queries.ts";
import { useToast } from "../lib/toast.tsx";

export default function SettingsPage() {
  const { data: user, isLoading } = useQuery(meQuery());
  const { data: aiStatus } = useQuery(aiStatusQuery());
  const queryClient = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [keyInput, setKeyInput] = useState("");
  /** 激活失败的原文（直接显示在输入框下面，比 toast 更不容易看漏） */
  const [codeError, setCodeError] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);

  const saveKey = useMutation({
    mutationFn: (value: string) => api<{ user: User }>("/api/ai/key", { method: "PUT", body: { key: value } }),
    onSuccess: (data) => {
      queryClient.setQueryData(meQuery().queryKey, data.user);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      setKeyInput("");
      toast.push(data.user.hasByok ? "Key 已保存，AI 功能立即可用" : "Key 已清除", "success");
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  const activate = useMutation({
    mutationFn: (value: string) =>
      api<{ user: User }>("/api/ai/activate", { body: { code: value } }),
    onSuccess: (data) => {
      queryClient.setQueryData(meQuery().queryKey, data.user);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      setCode("");
      setCodeError("");
      toast.push("AI 功能已开通，可以去用了", "success");
    },
    onError: (error) => {
      setCodeError(errorMessage(error));
      toast.push(errorMessage(error), "error");
    },
  });

  const canUseAI = user?.canUseAI ?? false;
  const hasByok = user?.hasByok ?? false;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 pt-4 pb-3 sm:px-6">
        <h1 className="text-lg font-semibold text-slate-900">设置</h1>
        <p className="mt-0.5 text-[12px] text-slate-500">账号信息与 AI 功能授权</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {isLoading || !user ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {/* 账号 */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-[13px] font-semibold text-slate-800">账号</h2>
              <div className="flex items-center gap-3">
                <Avatar name={user.name} color={user.avatarColor} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-slate-800">{user.name}</p>
                  <p className="truncate text-[12px] text-slate-500">{user.email}</p>
                </div>
              </div>
            </section>

            {/* AI 授权 */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-slate-400" />
                <h2 className="text-[13px] font-semibold text-slate-800">AI 功能授权</h2>
                <span
                  className={
                    canUseAI
                      ? "ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                      : "ml-auto inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                  }
                >
                  {canUseAI ? <BadgeCheck className="size-3" /> : <Lock className="size-3" />}
                  {canUseAI ? "已开通" : "未开通"}
                </span>
              </div>

              <p className="text-[12px] leading-relaxed text-slate-500">
                会议纪要生成、AI 任务拆分会消耗大模型额度，需要管理员授权（用平台公用 Key），
                或在本页下方配置你自己的 Key。
                <strong className="font-medium text-slate-600">
                  语音转写使用平台公用额度，所有用户都能直接使用
                </strong>
                。其余功能（任务看板、DDL、文件区、贡献记录、会议录音管理）不受限制。
              </p>

              {canUseAI ? (
                <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
                  你已获得 AI 功能授权，可以正常使用「生成纪要」和「AI 拆分任务」（走平台公用 Key）。
                </p>
              ) : (
                <>
                  <form
                    className="mt-3 flex flex-col gap-2 sm:flex-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!code.trim()) {
                        setCodeError("请先输入授权码");
                        return;
                      }
                      setCodeError("");
                      activate.mutate(code.trim());
                    }}
                  >
                    <div
                      className={
                        codeError
                          ? "flex h-9 flex-1 items-center gap-2 rounded-lg border border-rose-300 bg-rose-50/40 px-3"
                          : "flex h-9 flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3"
                      }
                    >
                      <KeyRound className="size-3.5 shrink-0 text-slate-400" />
                      <input
                        value={code}
                        onChange={(event) => {
                          setCode(event.target.value);
                          if (codeError) setCodeError("");
                        }}
                        placeholder="在这里输入「AI 授权码」（不是 API Key）"
                        maxLength={64}
                        autoComplete="off"
                        className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400"
                      />
                    </div>
                    <Button type="submit" loading={activate.isPending} disabled={!code.trim()}>
                      激活授权
                    </Button>
                  </form>

                  {codeError && (
                    <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] leading-relaxed text-rose-700">
                      {codeError}
                    </p>
                  )}

                  {aiStatus?.activation?.usingDefault && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
                      服务端当前仍在使用内置默认授权码（<code className="font-mono">war-room-vip</code>）。
                      如果你已经在 <code className="font-mono">.env</code> 里改过
                      <code className="font-mono"> AI_ACTIVATION_CODE</code>，
                      说明它没被读到——请确认变量写在<strong>仓库根目录</strong>的
                      <code className="font-mono"> .env</code> 里，并重启 <code className="font-mono">npm run dev</code>。
                    </p>
                  )}
                </>
              )}

              <p className="mt-2 text-[11px] text-slate-400">
                授权码由管理员在服务器环境变量 `AI_ACTIVATION_CODE` 中配置。忘记的话找组长或老师要。
              </p>
            </section>

            {/* 自带 Key（BYOK） */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-1.5">
                <KeyRound className="size-4 text-slate-400" />
                <h2 className="text-[13px] font-semibold text-slate-800">我的 DeepSeek Key</h2>
                <span
                  className={
                    hasByok
                      ? "ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                      : "ml-auto inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                  }
                >
                  {hasByok ? <BadgeCheck className="size-3" /> : <Lock className="size-3" />}
                  {hasByok ? "已配置" : "未配置"}
                </span>
              </div>

              <p className="text-[12px] leading-relaxed text-slate-500">
                填写您自己的 Key 可无视限额无限使用 AI 功能；不填则需管理员授权并受额度限制。
              </p>

              {hasByok && (
                <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 font-mono text-[12px] text-slate-600">
                  当前：{user.byokHint}
                </p>
              )}

              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!keyInput.trim()) {
                    toast.push("请先粘贴你的 DeepSeek Key", "error");
                    return;
                  }
                  saveKey.mutate(keyInput.trim());
                }}
              >
                <div className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3">
                  <KeyRound className="size-3.5 shrink-0 text-slate-400" />
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                    placeholder="sk-...（DeepSeek 控制台里的 API Key）"
                    maxLength={200}
                    autoComplete="off"
                    className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400"
                  />
                </div>
                <Button type="submit" loading={saveKey.isPending} disabled={!keyInput.trim()}>
                  保存
                </Button>
                <a
                  href="https://platform.deepseek.com/api_keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 text-[13px] font-medium whitespace-nowrap text-slate-600 transition-colors hover:bg-slate-50"
                >
                  获取 Key
                  <ExternalLink className="size-3" />
                </a>
                {hasByok && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => saveKey.mutate("")}
                    loading={saveKey.isPending}
                  >
                    清除
                  </Button>
                )}
              </form>

              <button
                type="button"
                onClick={() => setGuideOpen((open) => !open)}
                className="mt-3 flex w-full items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-left text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-100"
              >
                <span>不知道 Key 怎么弄？点这里看 3 分钟图文步骤</span>
                <ChevronDown
                  className={cx("ml-auto size-3.5 shrink-0 transition-transform", guideOpen && "rotate-180")}
                />
              </button>

              {guideOpen && <ByokGuide />}

              <p className="mt-2 text-[11px] text-slate-400">
                Key 使用 AES-256-GCM 加密存储在服务端，接口只返回脱敏后的尾号，前端不会拿到明文。
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ 获取 Key 指南 ------------------------------ */

function ByokGuide() {
  return (
    <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
      <p className="text-[12px] leading-relaxed text-slate-600">
        本系统采用 <strong>BYOK（自带密钥）</strong>：你可以用自己的 DeepSeek Key
        无限使用「AI 会议纪要」和「AI 任务拆分」，不仅不排队，额度也完全由你自己掌控。
        申请只用 3 分钟，新用户通常还有免费额度。
      </p>

      <ol className="space-y-2.5">
        <li className="flex gap-2">
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[10px] font-semibold text-white">
            1
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-slate-700">注册并登录 DeepSeek 开放平台</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              打开{" "}
              <a
                href="https://platform.deepseek.com"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
              >
                platform.deepseek.com
              </a>{" "}
              用手机号或邮箱注册。
            </p>
          </div>
        </li>

        <li className="flex gap-2">
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[10px] font-semibold text-white">
            2
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-slate-700">完成实名认证</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              左侧菜单「实名认证」，按提示提供身份证号或支付宝扫码，1 分钟左右。
            </p>
          </div>
        </li>

        <li className="flex gap-2">
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[10px] font-semibold text-white">
            3
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-slate-700">确认额度（新用户一般有免费额度）</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              额度用完后可在左侧「充值」补给。小组作业这种用量，几十元通常能用很久（以官方实际计费为准）。
            </p>
          </div>
        </li>

        <li className="flex gap-2">
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[10px] font-semibold text-white">
            4
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-slate-700">创建 API Key（最关键的一步）</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              左侧「API Keys」→「创建 API Key」→ 起个名字（比如 war-room）→ 创建。
            </p>
            <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-800">
              ⚠️ 弹窗里那串 <code className="font-mono">sk-...</code> 只显示这一次，
              关掉就再也看不到了，请立刻复制；丢了只能再建一个新的。
            </p>
          </div>
        </li>
      </ol>

      <div className="rounded-lg border border-slate-200 bg-white p-2.5">
        <p className="text-[12px] font-medium text-slate-700">怎么填进作战室？</p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          就是本页上方的「我的 DeepSeek Key」输入框：粘贴 → 点「保存」。
          保存成功后输入框会清空，上方显示脱敏尾号（如{" "}
          <code className="font-mono">sk-abcd…wxyz</code>），就说明配置好了。
        </p>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
        <p className="flex items-center gap-1 text-[12px] font-medium text-emerald-800">
          <ShieldCheck className="size-3.5" />
          我的 Key 安全吗？
        </p>
        <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-emerald-800/90">
          <li>· 加密存储：Key 经 AES-256-GCM 加密后才写入数据库，不存明文。</li>
          <li>· 无明文下发：接口只返回脱敏尾号，管理员在后台也看不到你的完整 Key。</li>
          <li>· 调用路径：只在你触发 AI 功能时于服务端解密，直接发往 DeepSeek 官方接口。</li>
          <li>
            · 随时撤销：去 DeepSeek 控制台删掉该 Key，或在本页点「清除」即可停用。
          </li>
        </ul>
      </div>
    </div>
  );
}