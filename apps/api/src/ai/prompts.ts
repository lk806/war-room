import type { ChatMessage } from "./client.ts";

const SPLIT_SYSTEM = `你是课程小组的任务规划助手。把用户给的目标拆成 4-7 个可执行、可验收的任务。
只输出 JSON，结构为：
{"tasks":[{"title":"不超过 26 字","description":"不超过 80 字，写清交付物或验收标准","estimateHours":数字(1-12),"priority":"LOW|MEDIUM|HIGH","suggestedRole":"调研|设计|后端|前端|文档|测试|答辩"}]}
硬性要求：
1. 不要输出真实人名，suggestedRole 只能是岗位角色；
2. 任务之间不要重复，按执行先后排列；
3. 不要输出 JSON 以外的任何文字。`;

export function splitMessages(input: {
  goal: string;
  deadline?: string | null;
  hint?: string;
  memberCount: number;
}): ChatMessage[] {
  const lines = [
    `目标：${input.goal}`,
    `小组人数：${input.memberCount} 人`,
    input.deadline ? `截止时间：${input.deadline}` : "截止时间：未指定",
    input.hint ? `补充要求：${input.hint}` : "",
  ].filter(Boolean);

  return [
    { role: "system", content: SPLIT_SYSTEM },
    { role: "user", content: `${lines.join("\n")}\n\n请输出 JSON。` },
  ];
}

const MINUTES_SYSTEM = `你是小组会议的纪要助手。根据逐字稿输出结构化纪要与行动项。
只输出 JSON，结构为：
{"summary":"100 字以内","decisions":["决议，最多 5 条"],"risks":["风险，最多 4 条"],
 "actionItems":[{"title":"不超过 26 字","detail":"不超过 80 字","suggestedAssigneeName":"逐字稿中出现的人名或 null","suggestedDueOffsetDays":数字(1-14)}],
 "markdown":"Markdown 纪要，含 ## 摘要 / ## 决议 / ## 行动项 / ## 风险 四节"}
硬性要求：
1. 只能使用逐字稿里出现过的人名，没提到就填 null；
2. 不要编造逐字稿里没有的事实、数字或结论；
3. 不要输出 JSON 以外的任何文字。`;

export function minutesMessages(input: {
  title: string;
  transcriptText: string;
  memberNames: string[];
}): ChatMessage[] {
  return [
    { role: "system", content: MINUTES_SYSTEM },
    {
      role: "user",
      content: [
        `会议主题：${input.title}`,
        `参会人：${input.memberNames.join("、") || "未记录"}`,
        "",
        "逐字稿：",
        input.transcriptText.slice(0, 12_000),
        "",
        "请输出 JSON。",
      ].join("\n"),
    },
  ];
}
