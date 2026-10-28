import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Member, Task, TaskPriority, TaskStatus } from "@war-room/shared";
import { STATUS_META } from "@war-room/shared";
import { Button, Field, Input, Modal, Select, Textarea, cx } from "../ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { useToast } from "../../lib/toast.tsx";

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "LOW", label: "低" },
  { value: "MEDIUM", label: "中" },
  { value: "HIGH", label: "高" },
];

const toLocalInput = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

export default function TaskComposerModal({
  open,
  onClose,
  groupId,
  members,
  defaultStatus,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  members: Member[];
  defaultStatus: TaskStatus;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [estimateHours, setEstimateHours] = useState("");
  const toast = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setStatus(defaultStatus);
    setPriority("MEDIUM");
    setAssigneeId("");
    setDueAt("");
    setEstimateHours("");
  }, [open, defaultStatus]);

  const mutation = useMutation({
    mutationFn: () =>
      api<{ task: Task }>(`/api/groups/${groupId}/tasks`, {
        body: {
          title: title.trim(),
          description: description.trim(),
          status,
          priority,
          assigneeId: assigneeId || null,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          estimateHours: estimateHours ? Number(estimateHours) : null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["board", groupId] });
      toast.push("任务已创建", "success");
      onClose();
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建任务"
      description="标题 + 负责人 + DDL 就够用了，其他可以之后再补。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!title.trim()}
          >
            创建任务
          </Button>
        </>
      }
    >
      <div className="space-y-3.5 pb-2">
        <Field label="任务标题">
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：撰写需求规格说明书"
            maxLength={80}
          />
        </Field>

        <Field label="描述" hint="选填">
          <Textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="交付物是什么？验收标准是什么？"
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
              min={toLocalInput(new Date())}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="优先级">
            <div className="flex rounded-xl border border-slate-200 p-0.5">
              {PRIORITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPriority(option.value)}
                  className={cx(
                    "flex-1 rounded-[10px] py-1.5 text-[13px] font-medium transition-colors",
                    priority === option.value
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-50",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="预计工时" hint="小时">
            <Input
              type="number"
              min={0}
              max={999}
              step={0.5}
              value={estimateHours}
              onChange={(event) => setEstimateHours(event.target.value)}
              placeholder="例如：4"
            />
          </Field>
        </div>

        <Field label="初始状态">
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(STATUS_META) as TaskStatus[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={cx(
                  "flex items-center justify-center gap-1 rounded-lg border py-1.5 text-[12px] transition-colors",
                  status === value
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50",
                )}
              >
                <span className={cx("size-1.5 rounded-full", STATUS_META[value].dot)} />
                {STATUS_META[value].label}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
