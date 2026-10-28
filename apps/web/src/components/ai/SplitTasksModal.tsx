import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Trash2, Wand2 } from "lucide-react";
import type { Member, SplitItem, SplitPreview, Task, TaskPriority } from "@war-room/shared";
import { Button, Field, Input, Modal, Select, Textarea, cx } from "../ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { aiStatusQuery } from "../../lib/queries.ts";
import { useToast } from "../../lib/toast.tsx";

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "HIGH", label: "高" },
  { value: "MEDIUM", label: "中" },
  { value: "LOW", label: "低" },
];

export default function SplitTasksModal({
  open,
  onClose,
  groupId,
  members,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  members: Member[];
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const ai = useQuery(aiStatusQuery());

  const [goal, setGoal] = useState("");
  const [deadline, setDeadline] = useState("");
  const [hint, setHint] = useState("");
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [items, setItems] = useState<SplitItem[]>([]);

  useEffect(() => {
    if (!open) return;
    setGoal("");
    setDeadline("");
    setHint("");
    setPreview(null);
    setItems([]);
  }, [open]);

  const splitMutation = useMutation({
    mutationFn: () =>
      api<SplitPreview>(`/api/groups/${groupId}/ai/split`, {
        body: {
          goal: goal.trim(),
          deadline: deadline ? new Date(deadline).toISOString() : null,
          hint: hint.trim(),
        },
      }),
    onSuccess: (data) => {
      setPreview(data);
      setItems(data.items);
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api<{ tasks: Task[] }>(`/api/groups/${groupId}/tasks/batch`, {
        body: { items: items.filter((item) => item.title.trim().length > 0), jobId: preview?.jobId },
      }),
    onSuccess: ({ tasks }) => {
      void queryClient.invalidateQueries({ queryKey: ["board", groupId] });
      toast.push(`已创建 ${tasks.length} 个任务，去看板上确认一下`, "success");
      onClose();
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  const update = (index: number, patch: Partial<SplitItem>) => {
    setItems((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    );
  };

  const totalHours = items.reduce((sum, item) => sum + (item.estimateHours ?? 0), 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI 拆分任务"
      description="描述要完成的目标，AI 给出任务草稿，确认后才会进入看板。"
      size="xl"
      footer={
        preview ? (
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              改目标
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              loading={createMutation.isPending}
              disabled={items.filter((item) => item.title.trim()).length === 0}
            >
              创建 {items.filter((item) => item.title.trim()).length} 个任务
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={() => splitMutation.mutate()}
              loading={splitMutation.isPending}
              disabled={goal.trim().length < 2}
            >
              <Sparkles className="size-4" />
              生成草稿
            </Button>
          </>
        )
      }
    >
      {!preview ? (
        <div className="space-y-3.5 pb-2">
          <Field label="要完成的目标" hint="越具体越好">
            <Textarea
              autoFocus
              rows={3}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="例如：完成课程设计中期检查，需要交 PPT、演示视频和分工说明"
              maxLength={500}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="截止时间" hint="选填">
              <Input
                type="datetime-local"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
              />
            </Field>
            <Field label="补充要求" hint="选填">
              <Input
                value={hint}
                onChange={(event) => setHint(event.target.value)}
                placeholder="例如：4 个人分，别拆太细"
                maxLength={200}
              />
            </Field>
          </div>
          <p className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            <Wand2 className="size-3.5 shrink-0" />
            {ai.data?.engine === "mock"
              ? "当前是演示模式（未配置 AI_API_KEY），草稿来自内置样例。"
              : `当前使用 ${ai.data?.model ?? "大模型"} 生成，草稿仍需你确认。`}
          </p>
        </div>
      ) : (
        <div className="space-y-2 pb-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span
              className={cx(
                "rounded px-1.5 py-0.5 font-medium",
                preview.engine === "remote"
                  ? "bg-brand-50 text-brand-700"
                  : "bg-amber-50 text-amber-700",
              )}
            >
              {preview.engine === "remote" ? "大模型生成" : "演示样例"}
            </span>
            <span>共 {items.length} 个任务 · 合计 {totalHours} 小时</span>
            <span className="ml-auto">可以直接改标题、负责人和优先级</span>
          </div>

          {splitMutation.isPending && (
            <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
              <Loader2 className="size-3.5 animate-spin" /> 重新生成中…
            </p>
          )}

          <div className="space-y-2">
            {items.map((item, index) => (
              <div
                key={index}
                className="rounded-xl border border-slate-200 bg-white p-2.5"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-2 w-4 shrink-0 text-center text-[11px] font-medium text-slate-400">
                    {index + 1}
                  </span>
                  <Input
                    value={item.title}
                    onChange={(event) => update(index, { title: event.target.value })}
                    className="h-8 text-[13px]"
                    maxLength={80}
                  />
                  <button
                    type="button"
                    onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                    className="mt-1 rounded p-1 text-slate-300 hover:text-rose-500"
                    title="移除这条"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
                  <div className="w-[5.5rem]">
                    <Select
                      value={item.priority}
                      onChange={(event) =>
                        update(index, { priority: event.target.value as TaskPriority })
                      }
                      className="h-7 text-[12px]"
                    >
                      {PRIORITIES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}优先级
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-28">
                    <Select
                      value={item.assigneeId ?? ""}
                      onChange={(event) =>
                        update(index, { assigneeId: event.target.value || null })
                      }
                      className="h-7 text-[12px]"
                    >
                      <option value="">未指派</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] whitespace-nowrap text-slate-400">
                    <div className="w-16">
                      <Input
                        type="number"
                        min={0}
                        max={200}
                        step={0.5}
                        value={item.estimateHours ?? ""}
                        onChange={(event) =>
                          update(index, {
                            estimateHours: event.target.value ? Number(event.target.value) : null,
                          })
                        }
                        className="h-7 text-[12px]"
                      />
                    </div>
                    小时
                  </div>
                  {item.suggestedRole && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-slate-500">
                      {item.suggestedRole}
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="mt-1 pl-6 text-[11px] leading-relaxed text-slate-500">
                    {item.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
