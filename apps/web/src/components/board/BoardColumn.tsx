import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Member, Task, TaskStatus } from "@war-room/shared";
import { STATUS_META } from "@war-room/shared";
import { Plus } from "lucide-react";
import SortableTaskCard from "./TaskCard.tsx";
import { cx } from "../ui.tsx";

export default function BoardColumn({
  status,
  tasks,
  members,
  canApprove,
  onAdd,
  onOpenTask,
  onMoveTask,
  onDeleteTask,
}: {
  status: TaskStatus;
  tasks: Task[];
  members: Member[];
  /** 只有组长能把「待评审」推进到「已完成」 */
  canApprove: boolean;
  onAdd: (status: TaskStatus) => void;
  onOpenTask: (task: Task) => void;
  onMoveTask: (task: Task, status: TaskStatus) => void;
  onDeleteTask: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { type: "column" } });
  const meta = STATUS_META[status];

  return (
    <section
      className={cx(
        "flex w-[268px] shrink-0 flex-col rounded-2xl bg-slate-100/80 sm:w-auto sm:flex-1 sm:min-w-[220px]",
        isOver && "bg-brand-50/70 ring-2 ring-brand-200",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className={cx("size-2 rounded-full", meta.dot)} />
        <h3 className="text-[13px] font-semibold text-slate-700">{meta.label}</h3>
        <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
          {tasks.length}
        </span>
        {status !== "DONE" || canApprove ? (
          <button
            type="button"
            onClick={() => onAdd(status)}
            title={`在「${meta.label}」新建任务`}
            className="ml-auto rounded-lg p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
          >
            <Plus className="size-4" />
          </button>
        ) : (
          // 「已完成」列非组长不能直接新建
          <span
            className="ml-auto rounded-lg p-1 text-slate-300"
            title="只有组长可以直接在「已完成」列新建任务"
          >
            <Plus className="size-4" />
          </span>
        )}
      </header>

      <div
        ref={setNodeRef}
        className="thin-scrollbar flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
      >
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              assignee={members.find((member) => member.id === task.assigneeId)}
              canApprove={canApprove}
              onOpen={() => onOpenTask(task)}
              onMove={(next) => onMoveTask(task, next)}
              onDelete={() => onDeleteTask(task)}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-[12px] leading-relaxed text-slate-400">
            {meta.hint}
            <br />
            暂无任务
          </div>
        )}
      </div>
    </section>
  );
}
