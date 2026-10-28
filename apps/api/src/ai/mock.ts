import type { SplitItem, TranscriptSegment } from "@war-room/shared";

/**
 * 演示模式的内置样例：没有配置 API Key 时，接口与页面行为完全一致，
 * 只是内容来自这里，方便课堂演示、离线测试与答辩兜底。
 */

const fallbackSpeakers = ["林晓", "王锐", "陈嘉"];

export function mockTranscript(
  title: string,
  members: string[],
): { text: string; segments: TranscriptSegment[] } {
  const [a, b, c] = [members[0] ?? fallbackSpeakers[0], members[1] ?? fallbackSpeakers[1], members[2] ?? fallbackSpeakers[2]];

  const lines: { speaker: string; text: string }[] = [
    { speaker: a, text: `好，今天主要过一下「${title}」的进度，先说一下各自做到哪了。` },
    { speaker: b, text: "数据库 ER 图我画完了，五张核心表：用户、小组、任务、文件、会议，外键都加上了。" },
    { speaker: c, text: "前端看板这边拖拽已经能用，就是移动端卡片有点宽，我改一下。" },
    { speaker: a, text: "接口和前端字段对齐了吗？上次说文件要带 size 和 mime。" },
    { speaker: b, text: "带了，文件列表接口已经返回这两个字段，下载走鉴权接口。" },
    { speaker: c, text: "那我没问题，今晚就能联调完，明天给你看效果。" },
    { speaker: a, text: "中期检查的 PPT 还没做，本来昨天要交的，我们把它往后压两天行不行？" },
    { speaker: c, text: "可以，但我这周有三门考试，PPT 我最多帮你出两页。" },
    { speaker: b, text: "我来补测试那部分，接口用例已经有二十条了。" },
    { speaker: a, text: "行，那这周就这样定：ER 图和接口字段确认完，接口骨架继续，前端联调，PPT 我来收口。" },
  ];

  let cursor = 0;
  const segments: TranscriptSegment[] = lines.map((line) => {
    const start = cursor;
    const duration = Math.max(3, Math.round(line.text.length / 4));
    cursor += duration + 1;
    return { start, end: start + duration, speaker: line.speaker, text: line.text };
  });

  return {
    text: segments.map((segment) => `${segment.speaker}：${segment.text}`).join("\n"),
    segments,
  };
}

export function mockSplit(goal: string): SplitItem[] {
  const short = goal.length > 14 ? `${goal.slice(0, 12)}…` : goal;
  return [
    {
      title: `明确「${short}」的验收标准`,
      description: "把老师/作业要求拆成可检查的验收条目，写进需求文档。",
      estimateHours: 2,
      priority: "HIGH",
      suggestedRole: "文档",
      assigneeId: null,
    },
    {
      title: "调研同类方案并输出结论",
      description: "找 2-3 个参考实现或资料，总结可复用的部分与差异点。",
      estimateHours: 3,
      priority: "MEDIUM",
      suggestedRole: "调研",
      assigneeId: null,
    },
    {
      title: "设计数据结构与接口约定",
      description: "先定表结构与接口字段，前后端并行开发的基础。",
      estimateHours: 4,
      priority: "HIGH",
      suggestedRole: "后端",
      assigneeId: null,
    },
    {
      title: "实现核心功能主流程",
      description: "只做能跑通的最小闭环，细节留到联调阶段。",
      estimateHours: 8,
      priority: "HIGH",
      suggestedRole: "开发",
      assigneeId: null,
    },
    {
      title: "联调、测试与问题回归",
      description: "按验收条目逐项过一遍，记录问题并分配修复。",
      estimateHours: 4,
      priority: "MEDIUM",
      suggestedRole: "测试",
      assigneeId: null,
    },
    {
      title: "整理交付物与答辩材料",
      description: "文档、演示脚本、分工说明三件套，按贡献记录核对。",
      estimateHours: 3,
      priority: "MEDIUM",
      suggestedRole: "文档",
      assigneeId: null,
    },
  ];
}

export function mockMinutes(
  title: string,
  transcript: { segments: TranscriptSegment[] },
  members: string[],
): {
  summary: string;
  decisions: string[];
  risks: string[];
  markdown: string;
  actionItems: { title: string; detail: string; suggestedAssigneeName: string | null; suggestedDueOffsetDays: number }[];
} {
  const names = transcript.segments.map((segment) => segment.speaker).filter(Boolean);
  const pick = (index: number): string | null =>
    names[index] ?? members[index] ?? null;

  const actionItems = [
    {
      title: "完成数据库 ER 图与接口字段确认",
      detail: "把五张核心表的外键、文件字段（size / mime）与下载鉴权方式对齐，输出一页确认稿。",
      suggestedAssigneeName: pick(1),
      suggestedDueOffsetDays: 2,
    },
    {
      title: "搭建后端接口骨架并联调",
      detail: "任务 CRUD、文件上传下载、SSE 通道先跑通主流程。",
      suggestedAssigneeName: pick(1),
      suggestedDueOffsetDays: 4,
    },
    {
      title: "修复前端移动端卡片宽度并完成联调",
      detail: "看板卡片在 390px 宽度下的换行问题，联调文件区。",
      suggestedAssigneeName: pick(2),
      suggestedDueOffsetDays: 3,
    },
    {
      title: "中期检查 PPT 补充材料",
      detail: "组长收口整体结构，测试同学补充用例覆盖部分。",
      suggestedAssigneeName: pick(0),
      suggestedDueOffsetDays: 5,
    },
  ];

  const decisions = [
    "技术栈确定为 React + Fastify + SQLite，前端与接口同域部署",
    "文件下载统一走鉴权接口，不再暴露静态目录",
    "每周三 21:00 例会，纪要当天在作战室归档",
  ];

  const risks = [
    "中期检查材料已经逾期，需要用压缩范围的方式追赶",
    "数据库设计未最终确认前，前端字段可能返工",
  ];

  const summary = `本次会议围绕「${title}」同步了各自进度：数据库设计基本完成，前端看板可用但移动端待修，接口与字段约定已对齐。中期检查材料逾期，决定压缩范围并重新分配人手。`;

  const markdown = [
    `# ${title}`,
    "",
    "## 摘要",
    "",
    summary,
    "",
    "## 决议",
    "",
    ...decisions.map((item) => `- ${item}`),
    "",
    "## 行动项",
    "",
    ...actionItems.map(
      (item, index) =>
        `${index + 1}. **${item.title}** — ${item.detail}（建议负责人：${item.suggestedAssigneeName ?? "待定"}，${item.suggestedDueOffsetDays} 天内）`,
    ),
    "",
    "## 风险",
    "",
    ...risks.map((item) => `- ${item}`),
  ].join("\n");

  return { summary, decisions, risks, markdown, actionItems };
}
