import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Member, Task, TaskStatus } from "@war-room/shared";
import { STATUS_META } from "@war-room/shared";
import { Clock3, MoreHorizontal, Trash2 } from "lucide-react";
import { dueMeta } from "../../lib/format.ts";
import { Avatar, Menu, MenuItem, cx } from "../ui.tsx";

const PRIORITY_BORDER: Record<Task["priority"], string> = {
  HIGH: "border-l-rose-400",
  MEDIUM: "border-l-transparent",
  LOW: "border-l-slate-200",
};

export function TaskCardContent({
  task,
  assignee,
  dragging = false,
  onOpen,
  onMove,
  onDelete,
  canApprove = true,
}: {
  task: Task;
  assignee?: Member;
  dragging?: boolean;
  canApprove?: boolean;
  onOpen?: () => void;
  onMove?: (status: TaskStatus) => void;
  onDelete?: () => void;
}) {
  const due = dueMeta(task.dueAt, task.status);
  const overdue = due.urgency === "overdue";
  /** 非组长不能把任务移入「已完成」，菜单里直接不展示该项 */
  const movableStatuses = (Object.keys(STATUS_META) as TaskStatus[]).filter((status) => {
    if (status === task.status) return false;
    if (status === "DONE" && !canApprove) return false;
    return true;
  });

  return (
    <div
      onClick={onOpen}
      className={cx(
        "group relative cursor-grab rounded-xl border border-l-[3px] border-slate-200 bg-white p-3 transition-all active:cursor-grabbing",
        PRIORITY_BORDER[task.priority],
        overdue ? "ring-1 ring-rose-100" : "",
        dragging ? "cursor-grabbing shadow-xl ring-2 ring-brand-300" : "shadow-sm hover:border-slate-300 hover:shadow-md",
      )}
    >
      <div className="flex items-start gap-1.5">
        <p className="line-clamp-2 flex-1 text-[13px] leading-snug font-medium text-slate-800">
          {task.title}
        </p>
        {(onMove || onDelete) && (
          <div onPointerDown={(event) => event.stopPropagation()} className="-mt-1 -mr-1">
            <Menu button={<MoreHorizontal className="size-4" />}>
              {(close) => (
                <>
                  <p className="px-2.5 py-1 text-[11px] text-slate-400">移至</p>
                  {(Object.keys(STATUS_META) as TaskStatus[])
                    .filter((status) => movableStatuses.includes(status))
                    .map((status) => (
                      <MenuItem
                        key={status}
                        onClick={() => {
                          onMove?.(status);
                          close();
                        }}
                      >
                        <span
                          className={cx("size-1.5 rounded-full", STATUS_META[status].dot)}
                        />
                        {STATUS_META[status].label}
                      </MenuItem>
                    ))}
                  {onDelete && (
                    <>
                      <div className="my-1 h-px bg-slate-100" />
                      <MenuItem
                        danger
                        onClick={() => {
                          onDelete();
                          close();
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        删除任务
                      </MenuItem>
                    </>
                  )}
                </>
              )}
            </Menu>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={cx(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] whitespace-nowrap",
            due.className,
          )}
        >
          <Clock3 className="size-3" />
          {due.label}
        </span>
        <div className="flex items-center gap-1.5">
          {task.estimateHours ? (
            <span className="text-[11px] text-slate-400">{task.estimateHours}h</span>
          ) : null}
          {assignee ? (
            <Avatar name={assignee.name} color={assignee.avatarColor} size={22} />
          ) : (
            <span
              title="未指派"
              className="size-[22px] rounded-full border border-dashed border-slate-300"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function SortableTaskCard(props: {
  task: Task;
  assignee?: Member;
  canApprove?: boolean;
  onOpen: () => void;
  onMove: (status: TaskStatus) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: { type: "task", status: props.task.status },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cx("touch-manipulation", isDragging && "opacity-40")}
    >
      <TaskCardContent {...props} />
    </div>
  );
}
