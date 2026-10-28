/**
 * @war-room/shared
 * 前后端共享的「唯一事实来源」：Zod 校验契约 + TypeScript 类型 + 业务常量。
 * 新增接口时先在这里定义 schema，前端表单与后端路由共用同一份定义。
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 业务常量                                                            */
/* ------------------------------------------------------------------ */

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const GROUP_ROLES = ["LEADER", "MEMBER"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const STATUS_META: Record<
  TaskStatus,
  { label: string; hint: string; dot: string }
> = {
  TODO: { label: "待办", hint: "还没开始", dot: "bg-slate-400" },
  IN_PROGRESS: { label: "进行中", hint: "正在做", dot: "bg-brand-500" },
  REVIEW: { label: "待评审", hint: "等组员确认", dot: "bg-amber-500" },
  DONE: { label: "已完成", hint: "可以交作业了", dot: "bg-emerald-500" },
};

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; badge: string }
> = {
  LOW: { label: "低", badge: "bg-slate-100 text-slate-600" },
  MEDIUM: { label: "中", badge: "bg-sky-50 text-sky-700" },
  HIGH: { label: "高", badge: "bg-rose-50 text-rose-700" },
};

/** 贡献事件权重（唯一算分口径：改这里，前端图例、CSV、统计一起变） */
export const CONTRIBUTION_WEIGHTS = {
  task_completed: 10,
  task_reviewed: 4,
  file_uploaded: 2,
  comment_created: 1,
  task_created: 2,
  meeting_attended: 2,
  minutes_confirmed: 1,
} as const;

export type ContributionKind = keyof typeof CONTRIBUTION_WEIGHTS;

export const CONTRIBUTION_LABELS: Record<ContributionKind, string> = {
  task_completed: "完成任务",
  task_reviewed: "评审通过",
  file_uploaded: "上传文件",
  comment_created: "发表评论",
  task_created: "创建任务",
  meeting_attended: "参加会议",
  minutes_confirmed: "确认纪要",
};

/** 图例顺序：核心四项在前，符合"完成/评审/文件/评论"的讲解顺序 */
export const CONTRIBUTION_ORDER: ContributionKind[] = [
  "task_completed",
  "task_reviewed",
  "file_uploaded",
  "comment_created",
  "task_created",
  "meeting_attended",
  "minutes_confirmed",
];

/** 每个维度的品牌色（图表与 CSV 都复用） */
export const CONTRIBUTION_COLORS: Record<ContributionKind, string> = {
  task_completed: "#10b981",
  task_reviewed: "#0ea5e9",
  file_uploaded: "#f59e0b",
  comment_created: "#8b5cf6",
  task_created: "#94a3b8",
  meeting_attended: "#f43f5e",
  minutes_confirmed: "#14b8a6",
};

export const CONTRIBUTION_RANGES = ["week", "month", "all"] as const;
export type ContributionRange = (typeof CONTRIBUTION_RANGES)[number];

export const CONTRIBUTION_RANGE_LABELS: Record<ContributionRange, string> = {
  week: "近 7 天",
  month: "近 30 天",
  all: "全部",
};

/* ---------------------- P1：DDL 提醒 / 文件共享 ---------------------- */

export const REMINDER_LEVELS = ["24H", "1H"] as const;
export type ReminderLevel = (typeof REMINDER_LEVELS)[number];

export const REMINDER_META: Record<ReminderLevel, { label: string; short: string }> = {
  "24H": { label: "提前 24 小时", short: "24h" },
  "1H": { label: "提前 1 小时", short: "1h" },
};

/**
 * 单文件上限：200MB。
 * 服务端是流式落盘 + 计数拦截，不会把整个文件读进内存。
 */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** 人类可读的上限文案，前后端共用，避免两边写的数字不一致 */
export function formatFileLimit(bytes: number = MAX_FILE_BYTES): string {
  const round = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
  if (bytes >= 1024 ** 3) return `${round(bytes / 1024 ** 3)}GB`;
  if (bytes >= 1024 ** 2) return `${round(bytes / 1024 ** 2)}MB`;
  if (bytes >= 1024) return `${round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/**
 * 上传采用「黑名单」策略：除了明确的高危可执行/脚本类型，其它格式一律放行。
 * 这样 Word、PDF、压缩包、avif/heic 图片、各种特殊后缀（.fig/.sketch/.dwg…）都能传。
 */
export const BLOCKED_FILE_EXTENSIONS = [
  // Windows 可执行与安装包
  "exe", "dll", "msi", "msp", "com", "scr", "pif", "cpl", "ocx", "sys",
  // 脚本
  "bat", "cmd", "vbs", "vbe", "wsf", "wsh", "hta", "ps1", "psm1", "psd1",
  "sh", "bash", "zsh", "csh", "ksh", "run",
  // 二进制/其它可执行
  "bin", "elf", "so", "dylib", "class", "jar", "app", "reg",
] as const;

export const isBlockedFileExtension = (ext: string): boolean =>
  (BLOCKED_FILE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());

/** 上传区提示文案 */
export const ALLOWED_FILE_HINT = `支持绝大多数常见文件（Word / PDF / 压缩包 / 图片 / 音视频 / 设计稿等），单文件 ≤ ${formatFileLimit()}；可执行文件与脚本（exe / sh 等）会被拒绝`;

/* ------------------------------------------------------------------ */
/* 领域类型（API 出参）                                                 */
/* ------------------------------------------------------------------ */

export interface User {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  /** 是否已获得 AI 功能授权（用系统公用 Key），默认 false */
  canUseAI: boolean;
  /** 是否配置了自己的 DeepSeek Key（BYOK）。配了可以不依赖管理员授权 */
  hasByok: boolean;
  /** 自己 Key 的脱敏展示，如 sk-abc…5899；未配置为 null */
  byokHint: string | null;
}

/** 保存/清除自己的 DeepSeek Key（空字符串表示清除） */
export const updateAiKeySchema = z.object({
  key: z
    .string()
    .trim()
    .max(200, "Key 太长了")
    .refine((value) => value === "" || value.length >= 16, "Key 格式不正确，请粘贴完整的 Key"),
});
export type UpdateAiKeyInput = z.infer<typeof updateAiKeySchema>;

/** 输入 AI 授权码 */
export const activateAiSchema = z.object({
  code: z.string().trim().min(1, "请输入授权码").max(64, "授权码太长了"),
});
export type ActivateAiInput = z.infer<typeof activateAiSchema>;

export interface Group {
  id: string;
  name: string;
  course: string;
  inviteCode: string;
  ownerId: string;
  createdAt: string;
  memberCount: number;
  myRole: GroupRole;
}

export interface Member extends User {
  role: GroupRole;
  skills: string[];
  joinedAt: string;
}

export interface Task {
  id: string;
  groupId: string;
  parentId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  assigneeId: string | null;
  estimateHours: number | null;
  position: number;
  meetingId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface BoardData {
  group: Group;
  members: Member[];
  tasks: Task[];
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  body: string;
  createdAt: string;
}

export type ActivityType =
  | "CREATED"
  | "STATUS_CHANGED"
  | "ASSIGNED"
  | "UPDATED"
  | "COMMENTED";

export interface Activity {
  id: string;
  taskId: string;
  actorId: string;
  actorName: string;
  type: ActivityType;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface FileItem {
  id: string;
  groupId: string;
  uploaderId: string;
  uploaderName: string;
  uploaderColor: string;
  name: string;
  mime: string;
  size: number;
  version: number;
  taskId: string | null;
  taskTitle: string | null;
  downloadCount: number;
  createdAt: string;
  /** 云端存储（Supabase）时的公网地址；本地存储为 null，走 /download 接口 */
  url: string | null;
}

export interface ReminderItem {
  id: string;
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  level: ReminderLevel;
  dueAt: string | null;
  assigneeName: string | null;
  sentAt: string;
}

/** SSE 事件载荷：服务端广播、前端据此刷新缓存 */
export type BoardEvent =
  | { type: "task.created"; task: Task }
  | { type: "task.updated"; task: Task }
  | { type: "task.deleted"; taskId: string }
  | { type: "comment.created"; comment: Comment }
  | { type: "file.created"; file: FileItem }
  | { type: "file.deleted"; fileId: string }
  | {
      type: "reminder.due";
      reminder: {
        taskId: string;
        taskTitle: string;
        level: ReminderLevel;
        dueAt: string | null;
        assigneeName: string | null;
      };
    }
  | { type: "meeting.updated"; meetingId: string; status: MeetingStatus }
  | { type: "ping"; at: string };

/* ------------------------------------------------------------------ */
/* 校验 schema                                                         */
/* ------------------------------------------------------------------ */

const emailRule = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请填写昵称")
    .max(24, "昵称最多 24 个字符"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "请填写邮箱")
    .max(120, "邮箱过长")
    .refine(emailRule, "邮箱格式不正确"),
  password: z.string().min(6, "密码至少 6 位").max(64, "密码最多 64 位"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "请填写邮箱")
    .refine(emailRule, "邮箱格式不正确"),
  password: z.string().min(1, "请填写密码"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, "请填写小组名称").max(40, "小组名称最多 40 字"),
  course: z.string().trim().max(60, "课程名最多 60 字").optional().default(""),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const joinGroupSchema = z.object({
  inviteCode: z
    .string()
    .trim()
    .toUpperCase()
    // 老小组是 6 位、新建小组是 8 位，两种都接受，避免升级后旧码失效
    .min(6, "邀请码至少 6 位字符")
    .max(12, "邀请码最多 12 位字符")
    .regex(/^[A-Z0-9]+$/, "邀请码只能包含字母和数字"),
});
export type JoinGroupInput = z.infer<typeof joinGroupSchema>;

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "请填写任务标题").max(80, "标题最多 80 字"),
  description: z
    .string()
    .trim()
    .max(2000, "描述最多 2000 字")
    .optional()
    .default(""),
  status: z.enum(TASK_STATUSES).optional().default("TODO"),
  priority: z.enum(TASK_PRIORITIES).optional().default("MEDIUM"),
  dueAt: z.string().trim().min(1).nullable().optional(),
  assigneeId: z.string().trim().min(1).nullable().optional(),
  estimateHours: z.number().min(0).max(999).nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(80, "标题最多 80 字").optional(),
  description: z.string().trim().max(2000, "描述最多 2000 字").optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z.string().trim().min(1).nullable().optional(),
  assigneeId: z.string().trim().min(1).nullable().optional(),
  estimateHours: z.number().min(0).max(999).nullable().optional(),
  /** 乐观锁：带上客户端持有的 updatedAt，若已被他人修改则返回 409 */
  expectedUpdatedAt: z.string().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  position: z.number().finite(),
  expectedUpdatedAt: z.string().optional(),
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, "评论不能为空").max(1000, "评论最多 1000 字"),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

/* ------------------------------------------------------------------ */
/* P2：会议纪要 + AI 任务拆分                                           */
/* ------------------------------------------------------------------ */

export const MEETING_STATUSES = [
  "DRAFT",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "SUMMARIZED",
  "FAILED",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_STATUS_META: Record<
  MeetingStatus,
  { label: string; className: string }
> = {
  DRAFT: { label: "待转写", className: "bg-slate-100 text-slate-600" },
  TRANSCRIBING: { label: "转写中", className: "bg-sky-50 text-sky-700" },
  TRANSCRIBED: { label: "已转写", className: "bg-brand-50 text-brand-700" },
  SUMMARIZED: { label: "已生成纪要", className: "bg-emerald-50 text-emerald-700" },
  FAILED: { label: "处理失败", className: "bg-rose-50 text-rose-700" },
};

/** AI 引擎：remote = 真实大模型 API，mock = 未配置 Key 时的演示实现 */
export type AiEngine = "remote" | "mock";

export interface TranscriptSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
}

export interface ActionItem {
  id: string;
  title: string;
  detail: string;
  suggestedAssigneeName: string | null;
  suggestedDueAt: string | null;
  status: "PENDING" | "CONVERTED";
  taskId: string | null;
}

export interface Meeting {
  id: string;
  groupId: string;
  title: string;
  startedAt: string;
  durationSec: number;
  status: MeetingStatus;
  hasAudio: boolean;
  audioUrl: string | null;
  transcript: Transcript | null;
  minutesMarkdown: string | null;
  actionItems: ActionItem[];
  error: string | null;
  createdByName: string;
  createdAt: string;
  engine: AiEngine;
}

export interface AiStatus {
  engine: AiEngine;
  model: string;
  asrModel: string;
  reason: string;
  /** 授权码的配置状态（只暴露状态，不暴露码本身） */
  activation: {
    /** 是否已启用自助开通（配置了非空授权码） */
    enabled: boolean;
    /** true = 用的是内置默认码（说明 .env 里的 AI_ACTIVATION_CODE 没读到） */
    usingDefault: boolean;
  };
}

export interface SplitItem {
  title: string;
  description: string;
  estimateHours: number | null;
  priority: TaskPriority;
  suggestedRole: string | null;
  assigneeId: string | null;
}

export interface SplitPreview {
  jobId: string;
  engine: AiEngine;
  goal: string;
  items: SplitItem[];
  /** 这次调用用的是谁的 Key：user=自带 / system=公用 / mock=演示样例 */
  keySource: "user" | "system" | "mock";
}

export const splitItemSchema = z.object({
  title: z.string().trim().min(1, "任务标题不能为空").max(80, "标题最多 80 字"),
  description: z.string().trim().max(500, "描述最多 500 字").optional().default(""),
  estimateHours: z.number().min(0).max(200).nullable().optional().default(null),
  priority: z.enum(TASK_PRIORITIES).optional().default("MEDIUM"),
  suggestedRole: z.string().trim().max(24).nullable().optional().default(null),
  assigneeId: z.string().trim().min(1).nullable().optional().default(null),
});
export type SplitItemInput = z.infer<typeof splitItemSchema>;

export const splitRequestSchema = z.object({
  goal: z.string().trim().min(2, "请描述要完成的目标").max(500, "目标描述最多 500 字"),
  deadline: z.string().trim().min(1).nullable().optional(),
  hint: z.string().trim().max(200).optional().default(""),
});
export type SplitRequest = z.infer<typeof splitRequestSchema>;

export const batchCreateTasksSchema = z.object({
  items: z.array(splitItemSchema).min(1, "至少选择一个任务").max(12, "一次最多创建 12 个任务"),
  jobId: z.string().optional(),
});
export type BatchCreateTasksInput = z.infer<typeof batchCreateTasksSchema>;

export const createMeetingSchema = z.object({
  title: z.string().trim().min(1, "请填写会议主题").max(60, "主题最多 60 字"),
  startedAt: z.string().trim().min(1).optional(),
  durationSec: z.number().min(0).max(6 * 3600).optional().default(0),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export const updateTranscriptSchema = z.object({
  text: z.string().trim().min(1, "逐字稿不能为空").max(20000, "逐字稿太长"),
});
export type UpdateTranscriptInput = z.infer<typeof updateTranscriptSchema>;

export const meetingTasksSchema = z.object({
  actionItemIds: z.array(z.string()).min(1, "至少选择一个行动项").max(20),
});
export type MeetingTasksInput = z.infer<typeof meetingTasksSchema>;

/* ------------------------------------------------------------------ */
/* P3：贡献记录                                                        */
/* ------------------------------------------------------------------ */

export interface ContributionMember {
  userId: string;
  name: string;
  avatarColor: string;
  role: GroupRole;
  score: number;
  events: number;
  /** 各维度的事件数（不是分数） */
  byKind: Record<ContributionKind, number>;
  lastActiveAt: string | null;
}

export interface ContributionKindStat {
  kind: ContributionKind;
  label: string;
  weight: number;
  color: string;
  count: number;
  score: number;
}

export interface ContributionWeek {
  /** 该周周一 00:00（本地时区）的 ISO 字符串 */
  weekStart: string;
  label: string;
  score: number;
  events: number;
}

export interface ContributionEventItem {
  id: string;
  userId: string;
  userName: string;
  avatarColor: string;
  kind: ContributionKind;
  label: string;
  weight: number;
  detail: string;
  createdAt: string;
}

export interface ContributionSummary {
  range: ContributionRange;
  from: string | null;
  to: string;
  totalScore: number;
  totalEvents: number;
  activeMembers: number;
  members: ContributionMember[];
  kinds: ContributionKindStat[];
  weeks: ContributionWeek[];
  recent: ContributionEventItem[];
}

export const contributionRangeSchema = z.object({
  range: z.enum(CONTRIBUTION_RANGES).optional().default("week"),
});

