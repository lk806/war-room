import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  AlarmClock,
  BellRing,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { ReminderItem, Task } from "@war-room/shared";
import TaskComposerModal from "../components/board/TaskComposerModal.tsx";
import TaskDrawer from "../components/board/TaskDrawer.tsx";
import { Avatar, Button, Spinner, cx } from "../components/ui.tsx";
import { useBoardRealtime } from "../hooks/useBoardRealtime.ts";
import { api, errorMessage } from "../lib/api.ts";
import { dueMeta, formatDateTime, relativeDueLabel, relativeTime } from "../lib/format.ts";
import { boardQuery, meQuery, remindersQuery } from "../lib/queries.ts";
import { useToast } from "../lib/toast.tsx";
import { useParams } from "react-router-dom";

const BUCKETS = [
  { key: "overdue", label: "已逾期", tone: "text-rose-600", hint: "需要马上处理" },
  { key: "today", label: "今天", tone: "text-amber-600", hint: "24 小时内到期" },
  { key: "tomorrow", label: "明天", tone: "text-slate-700", hint: "" },
  { key: "week", label: "未来 7 天", tone: "text-slate-700", hint: "" },
  { key: "later", label: "更晚", tone: "text-slate-500", hint: "" },
  { key: "none", label: "未设置 DDL", tone: "text-slate-400", hint: "建议补一个截止时间" },
  { key: "done", label: "已完成", tone: "text-emerald-600", hint: "" },
] as const;

type BucketKey = (typeof BUCKETS)[number]["key"];

function bucketOf(task: Task): BucketKey {
  if (task.status === "DONE") return "done";
  if (!task.dueAt) return "none";
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return "none";
  const now = new Date();
  if (due.getTime() < now.getTime()) return "overdue";
  const days = Math.round(
    (new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 7) return "week";
  return "later";
}

export default function DdlPage() {
  const { groupId = "" } = useParams<{ groupId: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: me } = useQuery(meQuery());
  const board = useQuery(boardQuery(groupId));
  const reminders = useQuery(remindersQuery(groupId));
  useBoardRealtime(groupId);

  const [view, setView] = useState<"list" | "calendar">("list");
  const [scope, setScope] = useState<"open" | "all">("open");
  const [onlyMine, setOnlyMine] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [composerOpen, setComposerOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const tasks = board.data?.tasks ?? [];
  const members = board.data?.members ?? [];
  const canApprove = board.data?.group.myRole === "LEADER";

  const filtered = useMemo(() => {
    return tasks.filter((task) => {
      if (scope === "open" && task.status === "DONE") return false;
      if (onlyMine && task.assigneeId !== me?.id) return false;
      return true;
    });
  }, [tasks, scope, onlyMine, me?.id]);

  const grouped = useMemo(() => {
    const map = new Map<BucketKey, Task[]>();
    for (const bucket of BUCKETS) map.set(bucket.key, []);
    for (const task of filtered) map.get(bucketOf(task))!.push(task);
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (!a.dueAt && !b.dueAt) return a.position - b.position;
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return a.dueAt.localeCompare(b.dueAt);
      });
    }
    return map;
  }, [filtered]);

  const stats = useMemo(() => {
    const open = tasks.filter((task) => task.status !== "DONE");
    return {
      overdue: open.filter((task) => bucketOf(task) === "overdue").length,
      today: open.filter((task) => bucketOf(task) === "today").length,
      week: open.filter((task) => ["today", "tomorrow", "week"].includes(bucketOf(task))).length,
      reminded: reminders.data?.length ?? 0,
    };
  }, [tasks, reminders.data]);

  const sweep = useMutation({
    mutationFn: () =>
      api<{ sent: number }>(`/api/groups/${groupId}/reminders/sweep`, { method: "POST" }),
    onSuccess: ({ sent }) => {
      void queryClient.invalidateQueries({ queryKey: ["reminders", groupId] });
      toast.push(
        sent > 0 ? `已发出 ${sent} 条提醒` : "检查完成：没有需要新增的提醒",
        sent > 0 ? "success" : "info",
      );
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  if (board.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const openTask = tasks.find((task) => task.id === openTaskId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 页头 */}
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 pt-4 pb-3 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">DDL 管理</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-slate-500">
              <span className={cx(stats.overdue > 0 && "font-medium text-rose-600")}>
                逾期 {stats.overdue}
              </span>
              <span className="text-slate-300">·</span>
              <span className={cx(stats.today > 0 && "font-medium text-amber-600")}>
                今天到期 {stats.today}
              </span>
              <span className="text-slate-300">·</span>
              <span>7 天内 {stats.week}</span>
              <span className="text-slate-300">·</span>
              <span>已提醒 {stats.reminded}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={sweep.isPending}
              onClick={() => sweep.mutate()}
              title="立即扫描一次 24 小时窗口，发提醒（演示用）"
            >
              <RefreshCw className="size-3.5" />
              <span className="max-sm:hidden">检查提醒</span>
            </Button>
            <Button size="sm" onClick={() => setComposerOpen(true)}>
              <Plus className="size-3.5" />
              新建任务
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 p-0.5">
            <button
              type="button"
              onClick={() => setView("list")}
              className={cx(
                "inline-flex items-center gap-1 rounded-[10px] px-2.5 py-1 text-[12px] font-medium transition-colors",
                view === "list" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <ListFilter className="size-3.5" />
              列表
            </button>
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={cx(
                "inline-flex items-center gap-1 rounded-[10px] px-2.5 py-1 text-[12px] font-medium transition-colors",
                view === "calendar" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <CalendarDays className="size-3.5" />
              日历
            </button>
          </div>

          <button
            type="button"
            onClick={() => setScope((value) => (value === "open" ? "all" : "open"))}
            className={cx(
              "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
              scope === "open"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {scope === "open" ? "只看未完成" : "全部任务"}
          </button>

          <button
            type="button"
            onClick={() => setOnlyMine((value) => !value)}
            className={cx(
              "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
              onlyMine
                ? "border-brand-300 bg-brand-50 text-brand-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            只看我的
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {view === "list" ? (
          <ListView
            grouped={grouped}
            members={members}
            onOpen={(task) => setOpenTaskId(task.id)}
            empty={filtered.length === 0}
          />
        ) : (
          <CalendarView
            tasks={filtered}
            members={members}
            monthCursor={monthCursor}
            selectedDay={selectedDay}
            onMonthChange={setMonthCursor}
            onSelectDay={setSelectedDay}
            onOpen={(task) => setOpenTaskId(task.id)}
          />
        )}

        <ReminderLog reminders={reminders.data ?? []} />
      </div>

      {composerOpen && (
        <TaskComposerModal
          open
          onClose={() => setComposerOpen(false)}
          groupId={groupId}
          members={members}
          defaultStatus="TODO"
        />
      )}

      {openTask && (
        <TaskDrawer
          key={openTask.id}
          groupId={groupId}
          task={openTask}
          members={members}
          canApprove={canApprove}
          onClose={() => setOpenTaskId(null)}
          onDelete={() => {
            if (window.confirm(`确定删除任务「${openTask.title}」？`)) {
              void api(`/api/tasks/${openTask.id}`, { method: "DELETE" })
                .then(() => {
                  setOpenTaskId(null);
                  void queryClient.invalidateQueries({ queryKey: ["board", groupId] });
                  toast.push("任务已删除", "success");
                })
                // 删除失败必须给反馈，否则看起来像按钮没反应
                .catch((error: unknown) => toast.push(errorMessage(error), "error"));
            }
          }}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  members,
  onOpen,
}: {
  task: Task;
  members: { id: string; name: string; avatarColor: string }[];
  onOpen: (task: Task) => void;
}) {
  const assignee = members.find((member) => member.id === task.assigneeId);
  const due = dueMeta(task.dueAt, task.status);
  const countdown = task.status === "DONE" ? "已完成" : relativeDueLabel(task.dueAt);

  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50/60"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-slate-800">{task.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400 sm:hidden">
          <span className={cx("rounded px-1 py-0.5", due.className)}>{countdown}</span>
          <span>{assignee?.name ?? "未指派"}</span>
        </p>
      </div>

      <span className="hidden w-24 items-center gap-1.5 text-[12px] text-slate-500 sm:flex">
        {assignee ? (
          <>
            <Avatar name={assignee.name} color={assignee.avatarColor} size={20} />
            <span className="truncate">{assignee.name}</span>
          </>
        ) : (
          <>
            <span className="size-5 rounded-full border border-dashed border-slate-300" />
            <span className="text-slate-400">未指派</span>
          </>
        )}
      </span>

      <span className="hidden w-[5.5rem] justify-center sm:flex">
        <span className={cx("rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap", due.className)}>
          {countdown}
        </span>
      </span>

      <span className="hidden w-28 text-right text-[11px] text-slate-400 lg:block">
        {formatDateTime(task.dueAt)}
      </span>

      <span className="hidden w-10 text-right text-[11px] text-slate-400 md:block">
        {task.estimateHours ? `${task.estimateHours}h` : "—"}
      </span>

      <span className="sm:hidden">
        {assignee ? (
          <Avatar name={assignee.name} color={assignee.avatarColor} size={24} />
        ) : (
          <span className="block size-6 rounded-full border border-dashed border-slate-300" />
        )}
      </span>
    </button>
  );
}

function ListView({
  grouped,
  members,
  onOpen,
  empty,
}: {
  grouped: Map<BucketKey, Task[]>;
  members: { id: string; name: string; avatarColor: string }[];
  onOpen: (task: Task) => void;
  empty: boolean;
}) {
  if (empty) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white py-14 text-center">
        <AlarmClock className="size-6 text-slate-300" />
        <p className="text-sm font-medium text-slate-700">还没有带截止时间的任务</p>
        <p className="text-[12px] text-slate-500">在任务里补上 DDL，这里就会按时间排好</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {BUCKETS.map((bucket) => {
        const items = grouped.get(bucket.key) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={bucket.key}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className={cx("text-[13px] font-semibold", bucket.tone)}>{bucket.label}</h2>
              <span className="text-[11px] text-slate-400">{items.length}</span>
              {bucket.hint && <span className="text-[11px] text-slate-400">· {bucket.hint}</span>}
            </div>
            <div className="space-y-1.5">
              {items.map((task) => (
                <TaskRow key={task.id} task={task} members={members} onOpen={onOpen} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CalendarView({
  tasks,
  members,
  monthCursor,
  selectedDay,
  onMonthChange,
  onSelectDay,
  onOpen,
}: {
  tasks: Task[];
  members: { id: string; name: string; avatarColor: string }[];
  monthCursor: Date;
  selectedDay: Date;
  onMonthChange: (date: Date) => void;
  onSelectDay: (date: Date) => void;
  onOpen: (task: Task) => void;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthCursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(monthCursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [monthCursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.dueAt) continue;
      const key = format(new Date(task.dueAt), "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const selectedKey = format(selectedDay, "yyyy-MM-dd");
  const selectedTasks = (byDay.get(selectedKey) ?? []).sort((a, b) =>
    (a.dueAt ?? "").localeCompare(b.dueAt ?? ""),
  );

  return (
    <div className="grid items-start justify-center gap-4 lg:grid-cols-[minmax(0,48rem)_20rem]">
      <section className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-[13px] font-semibold text-slate-800">
            {format(monthCursor, "yyyy 年 M 月")}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onMonthChange(subMonths(monthCursor, 1))}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="上个月"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                onMonthChange(today);
                onSelectDay(today);
              }}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
            >
              今天
            </button>
            <button
              type="button"
              onClick={() => onMonthChange(addMonths(monthCursor, 1))}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="下个月"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
            <div key={label} className="py-1 text-[11px] font-medium text-slate-400">
              {label}
            </div>
          ))}
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayTasks = byDay.get(key) ?? [];
            const inMonth = isSameMonth(day, monthCursor);
            const isTodayFlag = isSameDay(day, new Date());
            const isSelected = isSameDay(day, selectedDay);
            const hasOverdue = dayTasks.some(
              (task) => task.status !== "DONE" && task.dueAt && new Date(task.dueAt) < new Date(),
            );
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectDay(day)}
                className={cx(
                  "flex h-[4.2rem] min-w-0 flex-col items-stretch gap-0.5 overflow-hidden rounded-lg border p-1 text-left transition-colors sm:h-[4.6rem]",
                  isSelected
                    ? "border-brand-300 bg-brand-50/60"
                    : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                  !inMonth && "opacity-40",
                )}
              >
                <span
                  className={cx(
                    "flex size-5 items-center justify-center rounded-full text-[11px] font-medium",
                    isTodayFlag ? "bg-brand-600 text-white" : "text-slate-600",
                  )}
                >
                  {format(day, "d")}
                </span>
                <span className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                  {dayTasks.slice(0, 2).map((task) => (
                    <span
                      key={task.id}
                      title={task.title}
                      className={cx(
                        "truncate rounded px-1 text-[10px] leading-4",
                        hasOverdue && task.status !== "DONE"
                          ? "bg-rose-50 text-rose-600"
                          : task.status === "DONE"
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {task.title}
                    </span>
                  ))}
                  {dayTasks.length > 2 && (
                    <span className="px-1 text-[10px] text-slate-400">
                      +{dayTasks.length - 2}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-[13px] font-semibold text-slate-800">
          {format(selectedDay, "M 月 d 日")}
          <span className="ml-1.5 text-[11px] font-normal text-slate-400">
            {selectedTasks.length} 个任务
          </span>
        </h2>
        <div className="mt-2.5 space-y-1.5">
          {selectedTasks.length === 0 && (
            <p className="rounded-xl bg-slate-50 py-6 text-center text-[12px] text-slate-400">
              这天没有任务到期
            </p>
          )}
          {selectedTasks.map((task) => {
            const assignee = members.find((member) => member.id === task.assigneeId);
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpen(task)}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-left transition-colors hover:bg-slate-50"
              >
                <span className="text-[11px] text-slate-400">
                  {task.dueAt ? format(new Date(task.dueAt), "HH:mm") : "--:--"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">
                  {task.title}
                </span>
                {assignee && <Avatar name={assignee.name} color={assignee.avatarColor} size={20} />}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ReminderLog({ reminders }: { reminders: ReminderItem[] }) {
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <BellRing className="size-4 text-slate-400" />
        <h2 className="text-[13px] font-semibold text-slate-800">已发送的提醒</h2>
        <span className="text-[11px] text-slate-400">（24 小时 / 1 小时两级，自动去重）</span>
      </div>
      {reminders.length === 0 ? (
        <p className="rounded-xl bg-slate-50 py-6 text-center text-[12px] text-slate-400">
          还没有发出过提醒。任务进入 24 小时窗口后会自动在这里出现。
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {reminders.slice(0, 12).map((reminder) => (
            <li key={reminder.id} className="flex items-center gap-2 py-2 text-[12px]">
              <span
                className={cx(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                  reminder.level === "1H"
                    ? "bg-rose-50 text-rose-600"
                    : "bg-amber-50 text-amber-700",
                )}
              >
                {reminder.level === "1H" ? "提前 1h" : "提前 24h"}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-700">{reminder.taskTitle}</span>
              <span className="hidden text-slate-400 sm:inline">
                {reminder.assigneeName ?? "未指派"}
              </span>
              <span className="text-[11px] text-slate-400">{relativeTime(reminder.sentAt)}</span>
              <span className="hidden text-[11px] text-slate-400 sm:inline">
                {formatDateTime(reminder.dueAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
