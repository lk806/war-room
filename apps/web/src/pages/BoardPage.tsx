import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BoardData, Task, TaskStatus } from "@war-room/shared";
import { TASK_STATUSES } from "@war-room/shared";
import { Copy, Plus, Search, Sparkles, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import BoardColumn from "../components/board/BoardColumn.tsx";
import { TaskCardContent } from "../components/board/TaskCard.tsx";
import TaskComposerModal from "../components/board/TaskComposerModal.tsx";
import SplitTasksModal from "../components/ai/SplitTasksModal.tsx";
import TaskDrawer from "../components/board/TaskDrawer.tsx";
import { Avatar, Button, Input, Spinner, cx } from "../components/ui.tsx";
import { useBoardRealtime } from "../hooks/useBoardRealtime.ts";
import { api, errorMessage } from "../lib/api.ts";
import { dueMeta } from "../lib/format.ts";
import { boardQuery, meQuery } from "../lib/queries.ts";
import { useAiGate } from "../lib/ai-access.ts";
import { useToast } from "../lib/toast.tsx";

type Columns = Record<TaskStatus, Task[]>;

const emptyColumns = (): Columns => ({
  TODO: [],
  IN_PROGRESS: [],
  REVIEW: [],
  DONE: [],
});

const buildColumns = (tasks: Task[]): Columns => {
  const columns = emptyColumns();
  for (const task of [...tasks].sort((a, b) => a.position - b.position)) {
    columns[task.status].push(task);
  }
  return columns;
};

const isStatus = (value: string): value is TaskStatus =>
  (TASK_STATUSES as readonly string[]).includes(value);

/** 用前后邻居的中点算新位置，避免整列重排 */
function positionAt(list: Task[], index: number): number {
  const previous = list[index - 1];
  const next = list[index + 1];
  if (previous && next) return (previous.position + next.position) / 2;
  if (previous) return previous.position + 1024;
  if (next) return next.position - 1024;
  return 1024;
}

export default function BoardPage() {
  const { groupId = "" } = useParams<{ groupId: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const aiGate = useAiGate();
  const boardKey = ["board", groupId] as const;

  const { data: me } = useQuery(meQuery());
  const board = useQuery(boardQuery(groupId));
  useBoardRealtime(groupId);

  const [composerStatus, setComposerStatus] = useState<TaskStatus | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Columns | null>(null);

  const members = board.data?.members ?? [];
  const allTasks = board.data?.tasks ?? [];

  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    return allTasks.filter((task) => {
      if (assigneeFilter === "mine" && task.assigneeId !== me?.id) return false;
      if (assigneeFilter !== "all" && assigneeFilter !== "mine" && task.assigneeId !== assigneeFilter) {
        return false;
      }
      if (!text) return true;
      return (
        task.title.toLowerCase().includes(text) ||
        task.description.toLowerCase().includes(text)
      );
    });
  }, [allTasks, assigneeFilter, keyword, me?.id]);

  const baseColumns = useMemo(() => buildColumns(filtered), [filtered]);
  const columns = draft ?? baseColumns;

  const stats = useMemo(() => {
    const done = allTasks.filter((task) => task.status === "DONE").length;
    const overdue = allTasks.filter(
      (task) => task.status !== "DONE" && dueMeta(task.dueAt, task.status).urgency === "overdue",
    ).length;
    return { total: allTasks.length, done, overdue };
  }, [allTasks]);

  const moveMutation = useMutation({
    mutationFn: (payload: {
      taskId: string;
      status: TaskStatus;
      position: number;
      expectedUpdatedAt: string;
    }) =>
      api<{ task: Task }>(`/api/tasks/${payload.taskId}/move`, {
        method: "POST",
        body: {
          status: payload.status,
          position: payload.position,
          expectedUpdatedAt: payload.expectedUpdatedAt,
        },
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: boardKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => api(`/api/tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => {
      setOpenTaskId(null);
      void queryClient.invalidateQueries({ queryKey: boardKey });
      toast.push("任务已删除", "success");
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  /** 本地先落位（同步），再发请求；失败回滚整块看板快照 */
  const persistMove = (
    taskId: string,
    status: TaskStatus,
    position: number,
    expectedUpdatedAt: string,
  ) => {
    const snapshot = queryClient.getQueryData<BoardData>(boardKey);
    queryClient.setQueryData<BoardData>(boardKey, (current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === taskId ? { ...task, status, position } : task,
            ),
          }
        : current,
    );
    moveMutation.mutate(
      { taskId, status, position, expectedUpdatedAt },
      {
        onError: (error) => {
          if (snapshot) queryClient.setQueryData(boardKey, snapshot);
          toast.push(errorMessage(error), "error");
        },
      },
    );
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findStatus = (source: Columns, taskId: string): TaskStatus | null => {
    for (const status of TASK_STATUSES) {
      if (source[status].some((task) => task.id === taskId)) return status;
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setDraft(buildColumns(filtered));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    setDraft((current) => {
      if (!current) return current;
      const taskId = String(active.id);
      const overId = String(over.id);
      const from = findStatus(current, taskId);
      if (!from) return current;
      const to = isStatus(overId) ? overId : findStatus(current, overId);
      if (!to) return current;

      if (from === to) {
        const list = current[from];
        const oldIndex = list.findIndex((task) => task.id === taskId);
        const newIndex = list.findIndex((task) => task.id === overId);
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return current;
        return { ...current, [from]: arrayMove(list, oldIndex, newIndex) };
      }

      const moving = current[from].find((task) => task.id === taskId);
      if (!moving) return current;
      const targetList = current[to];
      const overIndex = targetList.findIndex((task) => task.id === overId);
      const insertAt = overIndex >= 0 ? overIndex : targetList.length;
      return {
        ...current,
        [from]: current[from].filter((task) => task.id !== taskId),
        [to]: [
          ...targetList.slice(0, insertAt),
          { ...moving, status: to },
          ...targetList.slice(insertAt),
        ],
      };
    });
  };

  /** 「已完成」只有组长能进（后端同样会拦，这里提前提示） */
  const canApprove = board.data?.group.myRole === "LEADER";
  const blockedApprove = (task: Task, status: TaskStatus): boolean => {
    if (status !== "DONE" || task.status === "DONE" || canApprove) return false;
    toast.push("只有组长可以把任务移到「已完成」，请叫组长来验收", "error");
    return true;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const finish = draft;
    setActiveId(null);
    setDraft(null);

    if (!over || !finish) return;
    const taskId = String(active.id);
    const status = findStatus(finish, taskId);
    if (!status) return;
    const list = finish[status];
    const index = list.findIndex((task) => task.id === taskId);
    const original = allTasks.find((task) => task.id === taskId);
    if (!original || index < 0) return;

    if (blockedApprove(original, status)) return;

    const position = positionAt(list, index);
    if (status === original.status && Math.abs(position - original.position) < 0.001) return;

    persistMove(taskId, status, position, original.updatedAt);
  };

  const moveToStatus = (task: Task, status: TaskStatus) => {
    if (status === task.status) return;
    if (blockedApprove(task, status)) return;
    const list = columns[status];
    persistMove(task.id, status, positionAt(list, 0), task.updatedAt);
  };

  const confirmDelete = (task: Task) => {
    if (window.confirm(`确定删除任务「${task.title}」？`)) deleteMutation.mutate(task.id);
  };

  const copyInvite = async () => {
    const code = board.data?.group.inviteCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.push("邀请码已复制", "success");
    } catch {
      toast.push(`邀请码：${code}`, "info");
    }
  };

  if (board.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (board.isError || !board.data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-slate-700">无法打开这个小组</p>
        <p className="max-w-sm text-[13px] text-slate-500">
          {board.error ? errorMessage(board.error) : "小组不存在或你没有访问权限"}
        </p>
        <Link to="/onboarding" className="text-[13px] font-medium text-brand-600">
          返回小组设置
        </Link>
      </div>
    );
  }

  const { group } = board.data;
  const openTask = allTasks.find((task) => task.id === openTaskId) ?? null;
  const activeTask = allTasks.find((task) => task.id === activeId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 页头 */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 pt-4 pb-3 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900">任务看板</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-slate-500">
              <span>{group.course || "未填写课程"}</span>
              <span className="text-slate-300">·</span>
              <span>{stats.total} 个任务</span>
              <span className="text-slate-300">·</span>
              <span>已完成 {stats.done}</span>
              {stats.overdue > 0 && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="font-medium text-rose-600">逾期 {stats.overdue}</span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={copyInvite} className="max-sm:hidden">
              <Copy className="size-3.5" />
              邀请码 {group.inviteCode}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={aiGate.lockedClass}
              onClick={() => {
                if (!aiGate.guard()) return;
                setSplitOpen(true);
              }}
              title={aiGate.allowed ? "描述目标，AI 拆成任务草稿，确认后进看板" : "未获得 AI 授权"}
            >
              <Sparkles className="size-3.5" />
              <span className="max-sm:hidden">AI 拆分任务</span>
            </Button>
            <Button size="sm" onClick={() => setComposerStatus("TODO")}>
              <Plus className="size-3.5" />
              新建任务
            </Button>
          </div>
        </div>

        {/* 筛选条 */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <FilterChip
              active={assigneeFilter === "all"}
              onClick={() => setAssigneeFilter("all")}
            >
              全部
            </FilterChip>
            <FilterChip
              active={assigneeFilter === "mine"}
              onClick={() => setAssigneeFilter("mine")}
            >
              我的
            </FilterChip>
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                title={`只看 ${member.name}`}
                onClick={() =>
                  setAssigneeFilter((current) => (current === member.id ? "all" : member.id))
                }
                className={cx(
                  "rounded-full p-0.5 transition-all",
                  assigneeFilter === member.id
                    ? "ring-2 ring-brand-400 ring-offset-1"
                    : "ring-1 ring-transparent hover:ring-slate-200",
                )}
              >
                <Avatar name={member.name} color={member.avatarColor} size={24} />
              </button>
            ))}
          </div>

          <div className="relative ml-auto w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索任务标题或描述"
              className="h-8 pl-8 text-[12px]"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                aria-label="清空搜索"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 看板主体 */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setDraft(null);
        }}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 py-3 sm:px-6">
          {TASK_STATUSES.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              tasks={columns[status]}
              members={members}
              canApprove={canApprove}
              onAdd={(value) => setComposerStatus(value)}
              onOpenTask={(task) => setOpenTaskId(task.id)}
              onMoveTask={moveToStatus}
              onDeleteTask={confirmDelete}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className="w-[252px] rotate-2">
              <TaskCardContent
                task={activeTask}
                assignee={members.find((member) => member.id === activeTask.assigneeId)}
                dragging
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {composerStatus !== null && (
        <TaskComposerModal
          open
          onClose={() => setComposerStatus(null)}
          groupId={groupId}
          members={members}
          defaultStatus={composerStatus}
        />
      )}

      <SplitTasksModal
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        groupId={groupId}
        members={members}
      />

      {openTask && (
        <TaskDrawer
          key={openTask.id}
          groupId={groupId}
          task={openTask}
          members={members}
          canApprove={canApprove}
          onClose={() => setOpenTaskId(null)}
          onDelete={() => confirmDelete(openTask)}
        />
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

