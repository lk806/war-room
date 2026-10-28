import type { ReactNode } from "react";

export default function AuthLayout({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex min-h-full bg-white">
      {/* 左侧品牌区：桌面端展示，移动端隐藏 */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-slate-900 p-12 lg:flex">
        <div className="pointer-events-none absolute -top-24 -left-24 size-96 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-0 size-80 rounded-full bg-sky-500/20 blur-3xl" />

        <div className="relative flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-brand-500 text-base font-bold text-white">
            战
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">小组作业作战室</p>
            <p className="text-[11px] tracking-[0.2em] text-slate-400">WAR ROOM</p>
          </div>
        </div>

        <div className="relative max-w-sm">
          <h1 className="text-[28px] leading-snug font-semibold text-white">
            把分工、进度和会议
            <br />
            放进同一个作战室
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-400">
            任务看板、DDL 倒计时、文件共享、贡献记录、AI 会议纪要——一个小组作业真正需要的东西。
          </p>
          <ul className="mt-8 space-y-3">
            {[
              ["任务看板", "拖一下就流转，谁在做什么一眼看清"],
              ["DDL 提醒", "24 小时 / 1 小时两级提醒，不再临期才发现"],
              ["贡献记录", "自动记录，答辩时不用凭印象分功"],
              ["AI 纪要", "录音自动转写，行动项一键变任务"],
            ].map(([name, desc]) => (
              <li key={name} className="flex items-start gap-2.5">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-400" />
                <span className="text-[13px] leading-relaxed text-slate-300">
                  <span className="font-medium text-white">{name}</span>
                  <span className="mx-1.5 text-slate-600">·</span>
                  {desc}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-slate-600">
          课程小组协作工具 · 中等难度 Web 项目
        </p>
      </div>

      {/* 右侧表单区 */}
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-7 flex items-center gap-2 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-xl bg-brand-500 text-base font-bold text-white">
              战
            </div>
            <p className="text-sm font-semibold text-slate-900">小组作业作战室</p>
          </div>
          <h2 className="text-[22px] font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 mb-6 text-[13px] text-slate-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
