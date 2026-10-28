import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Download,
  Info,
  Trophy,
  Users,
} from "lucide-react";
import { useParams } from "react-router-dom";
import type {
  ContributionKindStat,
  ContributionMember,
  ContributionRange,
  ContributionSummary,
} from "@war-room/shared";
import {
  CONTRIBUTION_COLORS,
  CONTRIBUTION_LABELS,
  CONTRIBUTION_ORDER,
  CONTRIBUTION_RANGE_LABELS,
  CONTRIBUTION_RANGES,
  CONTRIBUTION_WEIGHTS,
  type ContributionKind,
} from "@war-room/shared";
import { Avatar, Button, Spinner, cx } from "../components/ui.tsx";
import { useBoardRealtime } from "../hooks/useBoardRealtime.ts";
import { formatDateTimeShort, relativeTime } from "../lib/format.ts";
import { contributionsQuery, groupsQuery } from "../lib/queries.ts";
import { useToast } from "../lib/toast.tsx";

export default function ContributionsPage() {
  const { groupId = "" } = useParams<{ groupId: string }>();
  const [range, setRange] = useState<ContributionRange>("week");
  const { data, isLoading } = useQuery(contributionsQuery(groupId, range));
  const { data: groups } = useQuery(groupsQuery());
  const toast = useToast();
  useBoardRealtime(groupId);

  const summary = data;
  const groupName = groups?.find((item) => item.id === groupId)?.name ?? "小组";

  return (
    <div className="page-root flex h-full min-h-0 flex-col">
      <header className="no-print shrink-0 border-b border-slate-200 bg-white px-4 pt-4 pb-3 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">贡献记录</h1>
            <p className="mt-0.5 text-[12px] text-slate-500">
              按贡献事件自动累计 · 完成任务 10 / 评审 4 / 文件 2 / 评论 1
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-slate-200 p-0.5">
              {CONTRIBUTION_RANGES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRange(value)}
                  className={cx(
                    "rounded-[10px] px-2.5 py-1 text-[12px] font-medium transition-colors",
                    range === value
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {CONTRIBUTION_RANGE_LABELS[value]}
                </button>
              ))}
            </div>
            <a
              href={`/api/groups/${groupId}/contributions.csv?range=${range}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium whitespace-nowrap text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              <Download className="size-3.5" />
              导出 CSV
            </a>
            <Button
              size="sm"
              variant="secondary"
              className="max-sm:hidden"
              onClick={() => {
                // 图表是 CSS 背景绘制的，Chrome 默认不打印背景，会整块变白
                toast.push("打印对话框里请勾选「背景图形」，否则图表会显示为空白", "info");
                setTimeout(() => window.print(), 400);
              }}
            >
              打印
            </Button>
          </div>
        </div>
      </header>

      <div className="page-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {isLoading || !summary ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : summary.totalEvents === 0 ? (
          <EmptyState />
        ) : (
          <div className="print-stack print-full-width mx-auto max-w-5xl space-y-4">
            {/* 仅打印时显示的表头（标题 + 日期 + 统计口径） */}
            <PrintHeader
              groupName={groupName}
              rangeLabel={CONTRIBUTION_RANGE_LABELS[range]}
              kinds={summary.kinds}
            />

            <StatCards summary={summary} />

            <div className="print-grid-side grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <MemberRanking members={summary.members} />
              <MemberShare members={summary.members} totalScore={summary.totalScore} />
            </div>

            <TrendChart summary={summary} />
            <RecentEvents summary={summary} />
            <div className="print:hidden">
              <RulesCard kinds={summary.kinds} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ 打印表头 ------------------------------ */

/** 只在打印时出现：报表标题、小组、统计范围、打印时间、计分口径 */
function PrintHeader({
  groupName,
  rangeLabel,
  kinds,
}: {
  groupName: string;
  rangeLabel: string;
  kinds: ContributionKindStat[];
}) {
  const printedAt = formatDateTimeShort(new Date().toISOString());
  return (
    <div className="hidden print:block print-header">
      <h1 className="text-[15px] font-bold text-slate-900">小组作业作战室 - 贡献记录表</h1>
      <p className="mt-1 text-[9px] text-slate-600">
        小组：{groupName}　|　统计范围：{rangeLabel}　|　打印时间：{printedAt}
      </p>
      <p className="mt-0.5 text-[9px] text-slate-500">
        计分规则：
        {kinds.map((kind) => `${kind.label} ${kind.weight} 分`).join("、")}
      </p>
    </div>
  );
}

/* ------------------------------ 统计卡片 ------------------------------ */

function StatCards({ summary }: { summary: ContributionSummary }) {
  const average =
    summary.activeMembers > 0 ? Math.round(summary.totalScore / summary.activeMembers) : 0;

  const cards = [
    { label: "总贡献分", value: summary.totalScore, hint: "按权重累计" },
    { label: "贡献事件", value: summary.totalEvents, hint: "条 append-only 记录" },
    { label: "活跃成员", value: summary.activeMembers, hint: `共 ${summary.members.length} 人` },
    { label: "人均分", value: average, hint: "总分 / 活跃人数" },
  ];

  return (
    <div className="print-grid-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="print-stat rounded-2xl border border-slate-200 bg-white p-3.5">
          <p className="text-[11px] text-slate-500">{card.label}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{card.value}</p>
          <p className="print-hide-detail mt-0.5 text-[10px] text-slate-400">{card.hint}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ 成员排行 ------------------------------ */

function MemberRanking({ members }: { members: ContributionMember[] }) {
  const maxScore = Math.max(...members.map((member) => member.score), 1);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <Trophy className="size-4 text-amber-500" />
        <h2 className="text-[13px] font-semibold text-slate-800">成员贡献排行</h2>
        <span className="print-hide-detail ml-auto text-[11px] text-slate-400">条形按维度堆叠</span>
      </div>

      <div className="print-ranking space-y-3">
        {members.map((member, index) => {
          // 该成员各维度的得分 = 事件数 × 权重（权重是常量，与后端一致）
          const segments = CONTRIBUTION_ORDER.map((kind) => ({
            kind,
            color: CONTRIBUTION_COLORS[kind],
            score: (member.byKind[kind] ?? 0) * CONTRIBUTION_WEIGHTS[kind],
          })).filter((segment) => segment.score > 0);

          return (
            <div key={member.userId}>
              <div className="mb-1 flex items-center gap-2">
                <span className="w-4 text-[11px] font-medium text-slate-400">{index + 1}</span>
                <Avatar name={member.name} color={member.avatarColor} size={22} />
                <span className="truncate text-[13px] font-medium text-slate-800">
                  {member.name}
                </span>
                {member.role === "LEADER" && (
                  <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">组长</span>
                )}
                <span className="ml-auto shrink-0 text-[13px] font-semibold text-slate-900">
                  {member.score}
                  <span className="ml-0.5 text-[10px] font-normal text-slate-400">分</span>
                </span>
              </div>

              <div className="ml-6 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="flex h-full" style={{ width: `${(member.score / maxScore) * 100}%` }}>
                  {segments.map((segment) => (
                    <span
                      key={segment.kind}
                      title={`${CONTRIBUTION_LABELS[segment.kind]} ${segment.score} 分`}
                      style={{
                        width: `${(segment.score / member.score) * 100}%`,
                        backgroundColor: segment.color,
                      }}
                    />
                  ))}
                </div>
              </div>

              <p className="mt-1 ml-6 flex flex-wrap gap-x-2 text-[10px] text-slate-400">
                {CONTRIBUTION_ORDER.filter((kind) => (member.byKind[kind] ?? 0) > 0).map((kind) => (
                  <span key={kind}>
                    {SHORT_LABELS[kind]} {member.byKind[kind]}
                  </span>
                ))}
                {member.events === 0 && <span>暂无贡献</span>}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 排行下方的小字用短标签，避免一行放不下 */
const SHORT_LABELS: Record<ContributionKind, string> = {
  task_completed: "完成",
  task_reviewed: "评审",
  file_uploaded: "文件",
  comment_created: "评论",
  task_created: "建任务",
  meeting_attended: "参会",
  minutes_confirmed: "纪要",
};

/* ------------------------------ 成员占比 ------------------------------ */

/** 成员配色：按顺序分配，避免两个人的头像色撞车导致扇区分不清 */
const MEMBER_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
];

function MemberShare({
  members,
  totalScore,
}: {
  members: ContributionMember[];
  totalScore: number;
}) {
  const colorOf = (index: number) => MEMBER_COLORS[index % MEMBER_COLORS.length]!;
  const percentOf = (score: number) =>
    totalScore > 0 ? (score / totalScore) * 100 : 0;

  // 只为有分数的人画扇区，但图例列出全部成员（0 分也要能看到）
  const active = members
    .map((member, index) => ({ member, color: colorOf(index), index }))
    .filter((item) => item.member.score > 0);

  let cursor = 0;
  const stops = active.map((item) => {
    const start = cursor;
    cursor += percentOf(item.member.score);
    return `${item.color} ${start}% ${cursor}%`;
  });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <BarChart3 className="size-4 text-slate-400" />
        <h2 className="text-[13px] font-semibold text-slate-800">成员计分占比</h2>
        <span className="print-hide-detail ml-auto text-[11px] text-slate-400">按总分占比</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative size-28 shrink-0">
          <div
            className="size-28 rounded-full"
            style={{
              background:
                stops.length > 0
                  ? `conic-gradient(${stops.join(", ")})`
                  : "conic-gradient(#e2e8f0 0% 100%)",
            }}
          />
          <div className="absolute inset-[14px] flex flex-col items-center justify-center rounded-full bg-white">
            <span className="text-lg font-semibold text-slate-900">{totalScore}</span>
            <span className="text-[10px] text-slate-400">总分</span>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-1">
          {members.map((member, index) => (
            <li key={member.userId} className="flex items-center gap-1.5 text-[11px]">
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{ backgroundColor: colorOf(index) }}
              />
              <span className="min-w-0 flex-1 truncate text-slate-600">{member.name}</span>
              <span className="shrink-0 tabular-nums text-slate-400">
                {member.score} 分 · {percentOf(member.score).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------ 趋势图 ------------------------------ */

function TrendChart({ summary }: { summary: ContributionSummary }) {
  const max = Math.max(...summary.weeks.map((week) => week.score), 1);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <Users className="size-4 text-slate-400" />
        <h2 className="text-[13px] font-semibold text-slate-800">近 8 周贡献趋势</h2>
        <span className="print-hide-detail ml-auto text-[11px] text-slate-400">不受上方时间筛选影响</span>
      </div>

      <div className="flex h-28 items-end gap-1.5">
        {summary.weeks.map((week) => (
          <div key={week.weekStart} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] text-slate-400">{week.score > 0 ? week.score : ""}</span>
            <div
              className="w-full rounded-t bg-gradient-to-t from-brand-600 to-brand-400 transition-all"
              style={{
                // 用 px 而不是百分比：flex 子项里的百分比高度在部分浏览器会塌陷成 0
                height: `${Math.max((week.score / max) * 78, week.score > 0 ? 4 : 2)}px`,
              }}
              title={`${week.label} 周：${week.score} 分 / ${week.events} 次`}
            />
            <span className="text-[10px] text-slate-400">{week.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ 最近动态 ------------------------------ */

function RecentEvents({ summary }: { summary: ContributionSummary }) {
  return (
    <section className="print-avoid-break rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-[13px] font-semibold text-slate-800">最近动态</h2>
      <ul className="print-trim divide-y divide-slate-100">
        {summary.recent.map((event) => (
          <li key={event.id} className="flex items-center gap-2 py-2 text-[12px]">
            <Avatar name={event.userName} color={event.avatarColor} size={20} />
            <span className="w-14 shrink-0 truncate text-slate-600">{event.userName}</span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
              {event.label}
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-500">{event.detail}</span>
            <span className="shrink-0 text-[11px] font-medium text-emerald-600">
              +{event.weight}
            </span>
            <span
              className="hidden shrink-0 font-mono text-[11px] text-slate-400 sm:inline"
              title={relativeTime(event.createdAt)}
            >
              {formatDateTimeShort(event.createdAt)}
            </span>
          </li>
        ))}
      </ul>
      <p className="hidden pt-2 text-[9px] text-slate-400 print:block">
        打印版仅显示最近 8 条动态，完整记录请在系统中查看。
      </p>
    </section>
  );
}

/* ------------------------------ 计分规则 ------------------------------ */

function RulesCard({ kinds }: { kinds: ContributionKindStat[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Info className="size-4 text-slate-400" />
        <h2 className="text-[13px] font-semibold text-slate-800">计分规则</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {kinds.map((kind) => (
          <span
            key={kind.kind}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600"
          >
            <span className="size-2 rounded-sm" style={{ backgroundColor: kind.color }} />
            {kind.label}
            <b className="font-semibold text-slate-800">{kind.weight}</b> 分
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        所有分数来自 <code className="rounded bg-slate-100 px-1">contribution_events</code> 事件表，
        只增不改；任务回退到未完成会撤销对应的完成分。评审分只在该任务由「待评审」被<strong>负责人以外</strong>的人推进到「已完成」时记一次。
      </p>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-20 text-center">
      <Trophy className="size-8 text-slate-300" />
      <p className="text-sm font-medium text-slate-700">这段时间还没有贡献记录</p>
      <p className="text-[12px] leading-relaxed text-slate-500">
        建任务、完成任务、评审、传文件、评论都会自动计分；换个时间范围看看。
      </p>
    </div>
  );
}
