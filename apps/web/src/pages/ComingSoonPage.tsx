import { BarChart3, CalendarClock, CheckCircle2, FolderOpen, Mic, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../components/ui.tsx";

const ICONS = {
  ddl: CalendarClock,
  files: FolderOpen,
  contrib: BarChart3,
  minutes: Mic,
} as const;

export default function ComingSoonPage({
  moduleKey,
  title,
  phase,
  description,
  points,
}: {
  moduleKey: keyof typeof ICONS;
  title: string;
  phase: string;
  description: string;
  points: string[];
}) {
  const { groupId } = useParams<{ groupId: string }>();
  const Icon = ICONS[moduleKey];

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
            <Badge className="bg-amber-50 text-amber-700">{phase} 阶段实现</Badge>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">{description}</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
          <Sparkles className="size-4 text-brand-500" />
          这个模块将包含
        </p>
        <ul className="space-y-2.5">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-600">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-slate-300" />
              {point}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-[13px] font-medium text-slate-700">P0 已完成</p>
        <ul className="grid gap-2 text-[13px] text-slate-600 sm:grid-cols-2">
          {[
            "账号注册 / 登录 / 会话保持",
            "建组、邀请码加入、成员列表",
            "任务看板：创建、指派、拖拽流转",
            "SSE 实时同步（多人同时看板）",
            "任务详情：动态流与评论",
            "移动端布局：底部导航 + 状态菜单",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <Link
        to={`/g/${groupId}/board`}
        className="mt-5 inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700"
      >
        返回任务看板
      </Link>
    </div>
  );
}
