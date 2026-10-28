import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Activity,
  Comment,
  Member,
  Task,
  TaskPriority,
  TaskStatus,
} from "@war-room/shared";
import { STATUS_META } from "@war-room/shared";
import { MessageSquare, Send, Trash2, X } from "lucide-react";
import { Avatar, Button, Field, Input, Select, Textarea, cx } from "../ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { dateTimeLocalValue, relativeTime } from "../../lib/format.ts";
import { useToast } from "../../lib/toast.tsx";

const FIELD_LABELS: Record<string, string> = {
  title: "标题",
  description: "描述",
  priority: "优先级",
  dueAt: "截止时间",
  estimateHours: "预计工时",
  status: "状态",
  assignee: "负责人",
};

const statusLabel = (status: TaskStatus | null): string =>
  status ? STATUS_META[status].label : "—";

function activityText(item: Activity, members: Member[]): string {
  switch (item.type) {
    case "CREATED":
      return "创建了任务";
    case "STATUS_CHANGED":
      return `把状态从「${statusLabel(item.fromStatus)}」改为「${statusLabel(item.toStatus)}」`;
    case "ASSIGNED": {
      const to = (item.payload?.to as string | null | undefined) ?? null;
      if (!to) return "取消了指派";
      const name = members.find((member) => member.id === to)?.name ?? "组员";
      return `指派给 ${name}`;
    }
    case "UPDATED": {
      const fields = (item.payload?.fields as string[] | undefined) ?? [];
      if (fields.length === 0) return "更新了任务";
      return `更新了 ${fields.map((field) => FIELD_LABELS[field] ?? field).join("、")}`;
    }
    case "COMMENTED":
      return "发表了评论";
    default:
      return "修改了任务";
  }
}

export default function TaskDrawer({
  groupId,
  task,
  members,
  canApprove = true,
  onClose,
  onDelete,
}: {
  groupId: string;
  task: Task;
  members: Member[];
  /** 只有组长能把「待评审」推进到「已完成」 */
  canApprove?: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [dueAt, setDueAt] = useState(dateTimeLocalValue(task.dueAt));
  const [estimateHours, setEstimateHours] = useState(
    task.estimateHours === null ? "" : String(task.estimateHours),
  );
  const [commentBody, setCommentBody] = useState("");

  const boardKey = ["board", groupId];

  const commentsQuery = useQuery({
    queryKey: ["comments", task.id],
    queryFn: async () =>
      (await api<{ comments: Comment[] }>(`/api/tasks/${task.id}/comments`)).comments,
  });

  const activityQuery = useQuery({
    queryKey: ["activity", task.id],
    queryFn: async () =>
      (await api<{ activity: Activity[] }>(`/api/tasks/${task.id}/activity`)).activity,
  });

  const invalidateTask = () => {
    queryClient.invalidateQueries({ queryKey: boardKey });
    queryClient.invalidateQueries({ queryKey: ["activity", task.id] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api<{ task: Task }>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: {
          title: title.trim(),
          description: description.trim(),
          priority,
          assigneeId: assigneeId || null,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          estimateHours: estimateHours === "" ? null : Number(estimateHours),
          expectedUpdatedAt: task.updatedAt,
        },
      }),
    onSuccess: () => {
      invalidateTask();
      queryClient.invalidateQueries({ queryKey: ["comments", task.id] });
      toast.push("已保存", "success");
    },
    onError: (error) => {
      toast.push(errorMessage(error), "error");
      queryClient.invalidateQueries({ queryKey: boardKey });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: TaskStatus) =>
      api<{ task: Task }>(`/api/tasks/${task.id}/move`, {
        method: "POST",
        body: { status, position: task.position, expectedUpdatedAt: task.updatedAt },
      }),
    onSuccess: () => invalidateTask(),
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  const commentMutation = useMutation({
    mutationFn: () =>
      api<{ comment: Comment }>(`/api/tasks/${task.id}/comments`, {
        body: { body: commentBody.trim() },
      }),
    onSuccess: () => {
      setCommentBody("");
      queryClient.invalidateQueries({ queryKey: ["comments", task.id] });
      invalidateTask();
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  const assignee = members.find((member) => member.id === task.assigneeId);
  const comments = commentsQuery.data ?? [];
  const activity = activityQuery.data ?? [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />

      <aside className="animate-fade-in relative flex h-full w-full flex-col bg-white shadow-2xl sm:w-[440px]">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] text-slate-400">
              任务详情 · 创建于 {relativeTime(task.createdAt)}
            </p>
            <h2 className="text-[15px] leading-snug font-semibold text-slate-900">{task.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="thin-scrollbar flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 状态流转 */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-slate-500">状态</p>
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.keys(STATUS_META) as TaskStatus[]).map((status) => {
                const needsLeader = status === "DONE" && task.status !== "DONE" && !canApprove;
                return (
                  <button
                    key={status}
                    type="button"
                    disabled={statusMutation.isPending || needsLeader}
                    title={needsLeader ? "只有组长可以把任务移到「已完成」" : undefined}
                    onClick={() => {
                      if (status === task.status) return;
                      statusMutation.mutate(status);
                    }}
                    className={cx(
                      "flex items-center justify-center gap-1 rounded-lg border py-1.5 text-[12px] transition-colors",
                      status === task.status
                        ? "border-brand-300 bg-brand-50 font-medium text-brand-700"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50",
                      needsLeader && "cursor-not-allowed opacity-40 hover:bg-transparent",
                    )}
                  >
                    <span className={cx("size-1.5 rounded-full", STATUS_META[status].dot)} />
                    {STATUS_META[status].label}
                  </button>
                );
              })}
            </div>
            {task.status !== "DONE" && !canApprove && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                「已完成」由组长验收后勾选，你可以先把任务放到「待评审」。
              </p>
            )}
          </div>

          <div className="space-y-3.5">
            <Field label="标题">
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
            </Field>

            <Field label="描述">
              <Textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="补充交付物、验收标准、参考链接…"
                maxLength={2000}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="负责人">
                <Select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                  <option value="">未指派</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="截止时间">
                <Input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="优先级">
                <Select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as TaskPriority)}
                >
                  <option value="LOW">低</option>
                  <option value="MEDIUM">中</option>
                  <option value="HIGH">高</option>
                </Select>
              </Field>
              <Field label="预计工时" hint="小时">
                <Input
                  type="number"
                  min={0}
                  max={999}
                  step={0.5}
                  value={estimateHours}
                  onChange={(event) => setEstimateHours(event.target.value)}
                />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                {assignee && <Avatar name={assignee.name} color={assignee.avatarColor} size={18} />}
                {assignee ? `当前负责人：${assignee.name}` : "尚未指派负责人"}
              </div>
              <Button size="sm" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
                保存修改
              </Button>
            </div>
          </div>

          <div className="h-px bg-slate-100" />

          {/* 动态 */}
          <section>
            <p className="mb-2 text-[11px] font-medium text-slate-500">动态</p>
            <ol className="space-y-2.5">
              {activity.map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-[12px] text-slate-600">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-300" />
                  <span className="leading-relaxed">
                    <span className="font-medium text-slate-700">{item.actorName}</span>{" "}
                    {activityText(item, members)}
                    <span className="ml-1 text-[11px] text-slate-400">
                      {relativeTime(item.createdAt)}
                    </span>
                  </span>
                </li>
              ))}
              {activity.length === 0 && (
                <li className="text-[12px] text-slate-400">还没有动态</li>
              )}
            </ol>
          </section>

          <div className="h-px bg-slate-100" />

          {/* 评论 */}
          <section>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <MessageSquare className="size-3.5" />
              评论 {comments.length > 0 && `(${comments.length})`}
            </p>
            <div className="space-y-2.5">
              {comments.map((comment) => (
                <div key={comment.id} className="flex items-start gap-2">
                  <Avatar name={comment.authorName} color={comment.authorColor} size={24} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-slate-400">
                      <span className="font-medium text-slate-600">{comment.authorName}</span>
                      <span className="ml-1.5">{relativeTime(comment.createdAt)}</span>
                    </p>
                    <p className="mt-0.5 rounded-xl rounded-tl-sm bg-slate-50 px-2.5 py-1.5 text-[12px] leading-relaxed break-words text-slate-700">
                      {comment.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-2.5 flex items-end gap-2">
              <Textarea
                rows={2}
                value={commentBody}
                onChange={(event) => setCommentBody(event.target.value)}
                placeholder="写点什么，@组长 会看到"
                maxLength={1000}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="dark"
                disabled={!commentBody.trim()}
                loading={commentMutation.isPending}
                onClick={() => commentMutation.mutate()}
                aria-label="发送评论"
              >
                <Send className="size-3.5" />
              </Button>
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 text-[12px] text-rose-600 hover:text-rose-700"
          >
            <Trash2 className="size-3.5" />
            删除任务
          </button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            关闭
          </Button>
        </footer>
      </aside>
    </div>
  );
}
