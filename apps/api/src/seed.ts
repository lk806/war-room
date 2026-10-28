/**
 * 演示数据种子：4 名成员 + 1 个小组 + 10 个任务 + 评论 + 1 场带纪要的会议，
 * 第一次打开就能看到真实形态的看板与会议纪要。
 *
 * 用法：npm run seed（重复执行会跳过，如需重建请删除 apps/api/data/war-room.db）
 */
import { get, run } from "./db/index.ts";
import type { ContributionKind } from "@war-room/shared";
import { newId, nowIso } from "./lib/id.ts";
import { mockMinutes, mockTranscript } from "./ai/mock.ts";
import { buildActionItems } from "./services/meetings.ts";
import { addComment, createTask } from "./services/tasks.ts";
import { createGroup, joinGroup, recordContribution } from "./services/groups.ts";
import { register } from "./services/auth.ts";

const DEMO_EMAIL = "demo@war-room.local";

const existing = get<{ id: string }>("SELECT id FROM users WHERE email = ?", DEMO_EMAIL);
if (existing) {
  console.log("ℹ️  演示数据已存在，跳过。账号：demo@war-room.local / demo1234");
  process.exit(0);
}

const leader = register({ name: "林晓", email: DEMO_EMAIL, password: "demo1234" }).user;
const chen = register({ name: "陈嘉", email: "chen@war-room.local", password: "demo1234" }).user;
const wang = register({ name: "王锐", email: "wang@war-room.local", password: "demo1234" }).user;
const su = register({ name: "苏晴", email: "su@war-room.local", password: "demo1234" }).user;

// 演示账号默认开通 AI 功能（新注册的真实用户默认是关闭的）
run("UPDATE users SET can_use_ai = 1");

const group = createGroup(leader.id, {
  name: "数据结构 · 课程设计第 3 组",
  course: "数据结构与算法",
});
joinGroup(chen.id, group.inviteCode);
joinGroup(wang.id, group.inviteCode);
joinGroup(su.id, group.inviteCode);

const hoursFromNow = (hours: number): string =>
  new Date(Date.now() + hours * 3600 * 1000).toISOString();

interface SeedTask {
  title: string;
  description: string;
  status: "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH";
  assignee: string;
  dueInHours: number | null;
  estimateHours: number | null;
}

const seedTasks: SeedTask[] = [
  {
    title: "答辩稿与分工说明",
    description: "按贡献记录整理每人负责的部分，答辩时逐页说明。",
    status: "TODO",
    priority: "MEDIUM",
    assignee: leader.id,
    dueInHours: 9 * 24,
    estimateHours: 3,
  },
  {
    title: "测试用例编写",
    description: "覆盖增删改查与权限校验，至少 20 条用例。",
    status: "TODO",
    priority: "MEDIUM",
    assignee: su.id,
    dueInHours: 6 * 24,
    estimateHours: 6,
  },
  {
    title: "前端看板页面开发",
    description: "任务卡片拖拽、负责人筛选、移动端底部导航。",
    status: "TODO",
    priority: "HIGH",
    assignee: chen.id,
    dueInHours: 5 * 24,
    estimateHours: 12,
  },
  {
    title: "后端接口骨架搭建",
    description: "任务 CRUD、鉴权、SSE 实时同步，先跑通再优化。",
    status: "TODO",
    priority: "HIGH",
    assignee: wang.id,
    dueInHours: 4 * 24,
    estimateHours: 10,
  },
  {
    title: "中期检查 PPT",
    description: "包含进度、风险、下周计划三部分，控制在 8 页内。",
    status: "TODO",
    priority: "HIGH",
    assignee: leader.id,
    dueInHours: -26,
    estimateHours: 4,
  },
  {
    title: "数据库 ER 图设计",
    description: "用户、小组、任务、文件、会议五张核心表，注意外键约束。",
    status: "IN_PROGRESS",
    priority: "HIGH",
    assignee: wang.id,
    dueInHours: 8,
    estimateHours: 4,
  },
  {
    title: "撰写需求规格说明书",
    description: "功能列表、非功能要求、验收标准，2 号前提交给老师。",
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    assignee: su.id,
    dueInHours: 2 * 24,
    estimateHours: 6,
  },
  {
    title: "调研现有图书管理系统竞品",
    description: "对比 3 个开源项目的功能与交互，输出一页结论。",
    status: "DONE",
    priority: "LOW",
    assignee: chen.id,
    dueInHours: -72,
    estimateHours: 3,
  },
  {
    title: "确定选题与分工方案",
    description: "已和老师确认选题，分工见任务看板。",
    status: "DONE",
    priority: "MEDIUM",
    assignee: leader.id,
    dueInHours: -120,
    estimateHours: 2,
  },
  {
    title: "第一次组会纪要归档",
    description: "确认技术栈与每周三晚例会，纪要待组员确认。",
    status: "REVIEW",
    priority: "LOW",
    assignee: leader.id,
    dueInHours: 3 * 24,
    estimateHours: 1,
  },
];

const created = seedTasks.map((task) =>
  createTask(
    // 演示数据里「已完成」的任务按组长验收处理（只有组长能进已完成）
    { groupId: group.id, userId: task.status === "DONE" ? leader.id : task.assignee },
    {
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assignee,
      dueAt: task.dueInHours === null ? null : hoursFromNow(task.dueInHours),
      estimateHours: task.estimateHours,
    },
  ),
);

const target = created[5]!;
addComment(
  { groupId: group.id, userId: wang.id },
  target.id,
  { body: "ER 图初版已画完，晚点发群里，麻烦陈嘉看下前端字段够不够。" },
);
addComment(
  { groupId: group.id, userId: chen.id },
  target.id,
  { body: "文件字段记得带 size 和 mime，前端要用来显示图标。" },
);

recordContribution(group.id, su.id, "file_uploaded", "file", "seed-file-1", {
  name: "需求规格说明书-v0.3.docx",
});

/* ---------------- 贡献事件回填：让贡献页有 6 周历史 ---------------- */
const backfill: {
  userId: string;
  kind: ContributionKind;
  detail: string;
  daysAgo: number;
  refType: string;
}[] = [
  { userId: leader.id, kind: "meeting_attended", detail: "第一次组会 · 选题确认", daysAgo: 40, refType: "meeting" },
  { userId: chen.id, kind: "file_uploaded", detail: "竞品调研-初稿.pptx", daysAgo: 38, refType: "file" },
  { userId: wang.id, kind: "comment_created", detail: "数据库设计讨论", daysAgo: 36, refType: "comment" },
  { userId: su.id, kind: "file_uploaded", detail: "需求规格说明书-v0.1.docx", daysAgo: 34, refType: "file" },
  { userId: leader.id, kind: "minutes_confirmed", detail: "第一次组会纪要", daysAgo: 33, refType: "meeting" },
  { userId: wang.id, kind: "file_uploaded", detail: "ER图-v1.drawio", daysAgo: 30, refType: "file" },
  { userId: chen.id, kind: "comment_created", detail: "前端字段对齐", daysAgo: 28, refType: "comment" },
  { userId: leader.id, kind: "meeting_attended", detail: "第二次组会 · 进度同步", daysAgo: 27, refType: "meeting" },
  { userId: su.id, kind: "comment_created", detail: "测试用例补充", daysAgo: 25, refType: "comment" },
  { userId: wang.id, kind: "task_reviewed", detail: "确认选题与分工方案", daysAgo: 23, refType: "task" },
  { userId: chen.id, kind: "file_uploaded", detail: "看板原型.fig", daysAgo: 21, refType: "file" },
  { userId: leader.id, kind: "comment_created", detail: "中期检查范围确认", daysAgo: 19, refType: "comment" },
  { userId: su.id, kind: "file_uploaded", detail: "测试用例-v1.xlsx", daysAgo: 17, refType: "file" },
  { userId: wang.id, kind: "comment_created", detail: "接口字段约定", daysAgo: 15, refType: "comment" },
  { userId: leader.id, kind: "meeting_attended", detail: "第三次组会 · 中期检查分工", daysAgo: 12, refType: "meeting" },
  { userId: chen.id, kind: "task_reviewed", detail: "调研现有图书管理系统竞品", daysAgo: 10, refType: "task" },
  { userId: su.id, kind: "comment_created", detail: "文档格式统一", daysAgo: 8, refType: "comment" },
  { userId: wang.id, kind: "file_uploaded", detail: "接口文档-v0.9.md", daysAgo: 6, refType: "file" },
  { userId: leader.id, kind: "minutes_confirmed", detail: "第三次组会纪要", daysAgo: 4, refType: "meeting" },
  { userId: chen.id, kind: "file_uploaded", detail: "看板截图-移动端.png", daysAgo: 2, refType: "file" },
];

backfill.forEach((item, index) => {
  recordContribution(
    group.id,
    item.userId,
    item.kind,
    item.refType,
    `seed-contrib-${index}`,
    { title: item.detail, name: item.detail },
    new Date(Date.now() - item.daysAgo * 86_400_000).toISOString(),
  );
});


/* ------------------------- 一场已完成纪要的会议 ------------------------- */
const meetingTitle = "第三次组会 · 中期检查分工";
const meetingId = newId();
const startedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
const memberNames = [leader.name, chen.name, wang.name, su.name];
const transcript = mockTranscript(meetingTitle, memberNames);
const minutes = mockMinutes(meetingTitle, transcript, memberNames);
const actionItems = buildActionItems(minutes.actionItems);

run(
  `INSERT INTO meetings
     (id, group_id, title, started_at, duration_sec, status, transcript_json,
      minutes_markdown, action_items_json, engine, created_by, created_at)
   VALUES (?, ?, ?, ?, ?, 'SUMMARIZED', ?, ?, ?, 'mock', ?, ?)`,
  meetingId,
  group.id,
  meetingTitle,
  startedAt,
  312,
  JSON.stringify(transcript),
  minutes.markdown,
  JSON.stringify(actionItems),
  leader.id,
  nowIso(),
);

console.log(`   会议：${meetingTitle}（已转写 + 纪要，${actionItems.length} 个行动项待转任务）`);

console.log(`
✅ 演示数据已生成

   小组：${group.name}
   邀请码：${group.inviteCode}
   成员：林晓(组长) / 陈嘉 / 王锐 / 苏晴

   登录账号：demo@war-room.local
   登录密码：demo1234
   （其他成员邮箱 chen@ / wang@ / su@ war-room.local，密码相同）
`);
