/**
 * 本机 stub：模拟 OpenAI 兼容的 chat/completions 与 audio/transcriptions。
 * 仅用于验证「真实大模型调用链路」（请求格式、超时、JSON 校验、重试）。
 * 用法：node .tools/stub-llm.mjs [port]
 */
import http from "node:http";

const PORT = Number(process.argv[2] ?? 4899);
const calls = { chat: 0, asr: 0 };

const SPLIT_PAYLOAD = {
  tasks: [
    {
      title: "Stub 任务 A：确认验收标准",
      description: "把作业要求拆成可检查条目",
      estimateHours: 2,
      priority: "HIGH",
      suggestedRole: "文档",
    },
    {
      title: "Stub 任务 B：实现主流程",
      description: "最小闭环即可",
      estimateHours: 8,
      priority: "MEDIUM",
      suggestedRole: "后端",
    },
    {
      title: "Stub 任务 C：联调与验收",
      description: "逐项过验收条目",
      estimateHours: 3,
      priority: "LOW",
      suggestedRole: "测试",
    },
  ],
};

const MINUTES_PAYLOAD = {
  summary: "Stub 纪要摘要：确认了数据库设计与接口字段，中期材料顺延两天。",
  decisions: ["技术栈确定为 React + Fastify + SQLite", "文件下载统一走鉴权接口"],
  risks: ["中期检查材料逾期"],
  actionItems: [
    {
      title: "Stub 行动项：确认 ER 图与字段",
      detail: "五张核心表外键与文件字段对齐",
      suggestedAssigneeName: "王锐",
      suggestedDueOffsetDays: 2,
    },
    {
      title: "Stub 行动项：补中期 PPT 材料",
      detail: "补充测试覆盖部分",
      suggestedAssigneeName: "苏晴",
      suggestedDueOffsetDays: 4,
    },
  ],
  markdown: "# Stub 会议纪要\n\n## 摘要\n\nStub 纪要摘要：确认了数据库设计与接口字段，中期材料顺延两天。\n\n## 决议\n\n- 技术栈确定为 React + Fastify + SQLite\n\n## 行动项\n\n1. **Stub 行动项：确认 ER 图与字段** — 五张核心表外键与文件字段对齐\n\n## 风险\n\n- 中期检查材料逾期",
};

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/__calls") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(calls));
    return;
  }

  if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
    const raw = await readBody(req);
    let body = {};
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      /* ignore */
    }
    const userText = (body.messages ?? [])
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n");

    calls.chat += 1;
    const isMinutes = userText.includes("逐字稿");
    const payload = isMinutes ? MINUTES_PAYLOAD : SPLIT_PAYLOAD;
    const auth = req.headers.authorization ?? "";

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "stub-1",
        model: body.model ?? "stub-model",
        choices: [{ message: { role: "assistant", content: JSON.stringify(payload) } }],
        usage: { total_tokens: 321 },
        // 把收到的鉴权头回显出来，方便断言携带了 Bearer
        echo: { auth: auth.slice(0, 12), protocol: isMinutes ? "minutes" : "split" },
      }),
    );
    return;
  }

  if (req.method === "POST" && req.url?.endsWith("/audio/transcriptions")) {
    await readBody(req);
    calls.asr += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        text: "大家好，今天过一下进度。数据库设计已经完成，接口字段也确认了。",
        segments: [
          { start: 0, end: 4.2, text: "大家好，今天过一下进度。" },
          { start: 4.2, end: 9.8, text: "数据库设计已经完成，接口字段也确认了。" },
        ],
      }),
    );
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "stub: not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`stub-llm listening on http://127.0.0.1:${PORT}`);
});
