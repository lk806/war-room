/**
 * P2 功能自检：
 *   node scripts/check-p2.mjs [baseUrl] [mock|remote]
 * mock   —— 未配置 Key 时的演示模式（内置样例）
 * remote —— 指向本机 stub 的真实 API 链路（证明请求/解析/校验可用）
 * 音频文件自动生成（1 秒静音 wav），无需额外准备。
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4000";
const MODE = (process.argv[3] ?? "mock").toLowerCase();
const AUDIO = process.argv[4] ? path.resolve(process.argv[4]) : "";

/** 生成 1 秒静音 wav，保证脚本可独立运行 */
function buildWav(seconds = 1, sampleRate = 8000) {
  const samples = sampleRate * seconds;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

const audioBytes = AUDIO && fs.existsSync(AUDIO) ? fs.readFileSync(AUDIO) : buildWav();

let cookie = "";
let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    console.log(`  ❌ ${name} ${detail}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jar = (res) => {
  for (const item of res.headers.getSetCookie?.() ?? []) {
    const pair = item.split(";")[0];
    if (pair.startsWith("wr_session=")) cookie = pair;
  }
};

async function call(method, path, body, expectStatus) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  jar(res);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (expectStatus !== undefined && res.status !== expectStatus) {
    throw new Error(`${method} ${path} -> ${res.status}（期望 ${expectStatus}）: ${text.slice(0, 200)}`);
  }
  return { status: res.status, data };
}

console.log(`\n🔍 P2 自检 [${MODE}] ${BASE}\n`);

/* ---------------- 登录 ---------------- */
await call("POST", "/api/auth/login", { email: "demo@war-room.local", password: "demo1234" }, 200);
const groups = (await call("GET", "/api/groups", undefined, 200)).data.groups;
const group = groups[0];
check("登录并拿到小组", Boolean(group?.id));

/* ---------------- AI 权限门槛（受限功能） ---------------- */
const CODE = (() => {
  if (process.env.AI_ACTIVATION_CODE) return process.env.AI_ACTIVATION_CODE.trim();
  // 和服务端保持一致：从仓库根目录 .env 读，读不到再用内置默认值
  try {
    const text = fs.readFileSync(path.resolve(import.meta.dirname, "..", ".env"), "utf8");
    const matched = text.match(/^\s*AI_ACTIVATION_CODE\s*=\s*(.*)$/m);
    if (matched) return matched[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* 没有 .env 就走默认值 */
  }
  return "war-room-vip";
})();
const stamp = Date.now();
const newEmail = `p2-newbie-${stamp}@test.local`;

const newbie = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "新注册用户", email: newEmail, password: "pass12345" }),
});
const newbieCookie =
  (newbie.headers.getSetCookie?.() ?? [])
    .map((item) => item.split(";")[0])
    .find((pair) => pair.startsWith("wr_session=")) ?? "";
const newbieGroup = (
  await (
    await fetch(`${BASE}/api/groups`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: newbieCookie },
      body: JSON.stringify({ name: `P2 新人组-${stamp}`, course: "权限测试" }),
    })
  ).json()
).group;

const asNewbie = async (method, url, body) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      cookie: newbieCookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const meAfterRegister = await asNewbie("GET", "/api/auth/me");
check(
  "新注册用户 canUseAI 默认 false",
  meAfterRegister.data.user?.canUseAI === false,
  JSON.stringify(meAfterRegister.data.user),
);

const blockedSplit = await asNewbie("POST", `/api/groups/${newbieGroup.id}/ai/split`, { goal: "测试" });
check("未授权且无 Key 时调用 AI 拆分被拒（403）", blockedSplit.status === 403, `status=${blockedSplit.status}`);
check(
  "403 文案提示输入授权码或配置 Key",
  String(blockedSplit.data.error ?? "").includes("AI 授权码") &&
    String(blockedSplit.data.error ?? "").includes("API Key"),
  String(blockedSplit.data.error ?? ""),
);

/* ---------- BYOK：自带 Key 优先，且绕过授权 ---------- */
const saveKey = await asNewbie("PUT", "/api/ai/key", { key: "sk-test-byok-1234567890abcdef" });
check("保存自己的 DeepSeek Key 成功（200）", saveKey.status === 200, `status=${saveKey.status}`);
check("返回 hasByok 为 true", saveKey.data.user?.hasByok === true);
check(
  "只回传脱敏提示，不回传明文",
  typeof saveKey.data.user?.byokHint === "string" &&
    !saveKey.data.user.byokHint.includes("1234567890abcdef"),
  String(saveKey.data.user?.byokHint),
);
check("canUseAI 仍为 false（BYOK 不改授权位）", saveKey.data.user?.canUseAI === false);

const byokSplit = await asNewbie(
  "POST",
  `/api/groups/${newbieGroup.id}/ai/split`,
  { goal: "用自带 Key 拆分任务" },
);
check("配了 Key 后未授权也能调用 AI（200）", byokSplit.status === 200, `status=${byokSplit.status}`);
// mock 模式下强制不发起真实请求，所以 keySource 记为 mock；remote 模式才是 user
check(
  MODE === "remote" ? "本次调用用的是用户自己的 Key" : "mock 模式强制走演示样例",
  byokSplit.data.keySource === (MODE === "remote" ? "user" : "mock"),
  `keySource=${byokSplit.data.keySource}`,
);

const clearKey = await asNewbie("PUT", "/api/ai/key", { key: "" });
check("清除 Key 成功且 hasByok 变回 false", clearKey.data.user?.hasByok === false);

const blockedAgain = await asNewbie("POST", `/api/groups/${newbieGroup.id}/ai/split`, { goal: "清除后再试" });
check("清除 Key 后又被拦截（403）", blockedAgain.status === 403, `status=${blockedAgain.status}`);

const shortKey = await asNewbie("PUT", "/api/ai/key", { key: "sk-123" });
check("太短的 Key 被参数校验拦下（400）", shortKey.status === 400, `status=${shortKey.status}`);

/* ---------- ASR 是公用能力：没授权也能转写 ---------- */
const asrMeeting = (
  await asNewbie("POST", `/api/groups/${newbieGroup.id}/meetings`, { title: "ASR 公用测试" })
).data.meeting;
const asrForm = new FormData();
asrForm.append("file", new Blob([audioBytes], { type: "audio/wav" }), "asr-test.wav");
const asrUpload = await fetch(`${BASE}/api/meetings/${asrMeeting.id}/audio?duration=1`, {
  method: "POST",
  headers: { cookie: newbieCookie },
  body: asrForm,
});
check("未授权用户也能上传音频转写（202）", asrUpload.status === 202, `status=${asrUpload.status}`);

let asrStatus = "";
for (let i = 0; i < 20; i += 1) {
  await sleep(400);
  const detail = await asNewbie("GET", `/api/meetings/${asrMeeting.id}`);
  asrStatus = detail.data.meeting?.status ?? "";
  if (asrStatus === "TRANSCRIBED" || asrStatus === "FAILED") break;
}
check("未授权用户转写成功（走平台公用 ASR Key）", asrStatus === "TRANSCRIBED", `status=${asrStatus}`);

/* ---------- 授权码：走系统公用 Key ---------- */
const wrongCode = await asNewbie("POST", "/api/ai/activate", { code: "definitely-wrong" });
check("错误授权码被拒（403）", wrongCode.status === 403, `status=${wrongCode.status}`);

const goodCode = await asNewbie("POST", "/api/ai/activate", { code: CODE });
check("正确授权码开通成功（200）", goodCode.status === 200, `status=${goodCode.status}`);
check("开通后 canUseAI 变为 true", goodCode.data.user?.canUseAI === true);

const allowedSplit = await asNewbie(
  "POST",
  `/api/groups/${newbieGroup.id}/ai/split`,
  { goal: "测试开通后能调用" },
);
check("开通后 AI 拆分可用（200）", allowedSplit.status === 200, `status=${allowedSplit.status}`);
check(
  "未配 Key 时走系统公用 Key",
  allowedSplit.data.keySource === (MODE === "remote" ? "system" : "mock"),
  `keySource=${allowedSplit.data.keySource}`,
);

const emptyCode = await asNewbie("POST", "/api/ai/activate", { code: "" });
check("空授权码被参数校验拦下（400）", emptyCode.status === 400, `status=${emptyCode.status}`);

/* ---------------- AI 状态 ---------------- */
const status = (await call("GET", "/api/ai/status", undefined, 200)).data;
check(
  `AI 引擎状态 = ${MODE}`,
  status.engine === MODE,
  `实际 ${status.engine} / ${status.reason}`,
);
console.log(`     model=${status.model} asr=${status.asrModel}`);

/* ---------------- 任务拆分 ---------------- */
const splitRes = await call(
  "POST",
  `/api/groups/${group.id}/ai/split`,
  { goal: "完成课程设计的中期检查", deadline: new Date(Date.now() + 7 * 86400000).toISOString() },
  200,
);
const preview = splitRes.data;
check("拆分返回草稿任务", Array.isArray(preview.items) && preview.items.length >= 3, `items=${preview.items?.length}`);
check("草稿每条都有标题与优先级", preview.items.every((item) => item.title && item.priority));
check(
  MODE === "remote" ? "远程模式返回 stub 内容" : "演示模式返回内置样例",
  MODE === "remote"
    ? preview.items.some((item) => item.title.includes("Stub"))
    : preview.items.some((item) => item.title.includes("验收标准")),
  preview.items[0]?.title,
);

// 校验拦截
const badSplit = await call("POST", `/api/groups/${group.id}/ai/split`, { goal: "" }, 400);
check("空目标被参数校验拦下", badSplit.status === 400);

const batch = await call(
  "POST",
  `/api/groups/${group.id}/tasks/batch`,
  { items: preview.items.slice(0, 3), jobId: preview.jobId },
  201,
);
check("确认后批量建任务", batch.data.tasks?.length === 3);
const board = (await call("GET", `/api/groups/${group.id}/board`, undefined, 200)).data;
check(
  "新任务出现在看板",
  batch.data.tasks.every((task) => board.tasks.some((item) => item.id === task.id)),
);

/* ---------------- 会议：创建 ---------------- */
const meetingTitle = `P2 自检会议-${Date.now()}`;
const created = await call(
  "POST",
  `/api/groups/${group.id}/meetings`,
  { title: meetingTitle, durationSec: 0 },
  201,
);
const meetingId = created.data.meeting.id;
check("创建会议", Boolean(meetingId));
check("初始状态为待转写", created.data.meeting.status === "DRAFT");

/* ---------------- 会议：上传音频 + 转写 ---------------- */
const form = new FormData();
form.append("file", new Blob([audioBytes], { type: "audio/wav" }), "meeting.wav");
const upRes = await fetch(`${BASE}/api/meetings/${meetingId}/audio?duration=1`, {
  method: "POST",
  headers: { cookie },
  body: form,
});
const upJson = await upRes.json();
check("上传音频成功（202）", upRes.status === 202, JSON.stringify(upJson).slice(0, 160));
check("状态进入转写中", upJson.meeting?.status === "TRANSCRIBING", upJson.meeting?.status);

// 等待异步转写完成
let meeting = null;
for (let i = 0; i < 40; i += 1) {
  await sleep(300);
  const detail = await call("GET", `/api/meetings/${meetingId}`, undefined, 200);
  meeting = detail.data.meeting;
  if (meeting.status !== "TRANSCRIBING") break;
}
check("转写完成并保存逐字稿", meeting.status === "TRANSCRIBED", `status=${meeting.status} err=${meeting.error}`);
check("逐字稿包含分段", (meeting.transcript?.segments?.length ?? 0) >= 2, `segments=${meeting.transcript?.segments?.length}`);
check(
  MODE === "remote" ? "远程 ASR 内容正确" : "演示逐字稿内容正确",
  MODE === "remote"
    ? meeting.transcript.text.includes("数据库设计")
    : meeting.transcript.text.includes("数据库 ER 图"),
);

// 音频可回放
const audioRes = await fetch(`${BASE}/api/meetings/${meetingId}/audio`, { headers: { cookie } });
check("音频可回放", audioRes.status === 200 && Number(audioRes.headers.get("content-length") ?? 0) > 0);
check("音频不是 0 字节", (await audioRes.arrayBuffer()).byteLength > 100);

/* ---------------- 会议：人工修订逐字稿 ---------------- */
const patched = await call(
  "PATCH",
  `/api/meetings/${meetingId}/transcript`,
  { text: "林晓：先过一下进度。\n王锐：数据库设计已完成。" },
  200,
);
check("人工修订逐字稿生效", patched.data.meeting.transcript.segments.length === 2);

/* ---------------- 会议：生成纪要 ---------------- */
const minutes = await call("POST", `/api/meetings/${meetingId}/minutes`, undefined, 200);
const summarized = minutes.data.meeting;
check("状态进入已生成纪要", summarized.status === "SUMMARIZED", summarized.status);
check("纪要正文非空", (summarized.minutesMarkdown ?? "").length > 80);
check("解析出行动项", (summarized.actionItems?.length ?? 0) >= 2, `items=${summarized.actionItems?.length}`);
check(
  MODE === "remote" ? "远程纪要内容正确" : "演示纪要内容正确",
  MODE === "remote"
    ? summarized.minutesMarkdown.includes("Stub 纪要摘要")
    : summarized.minutesMarkdown.includes("摘要"),
);

/* ---------------- 会议：行动项转任务 ---------------- */
const ids = summarized.actionItems.map((item) => item.id);
const createdTasks = await call(
  "POST",
  `/api/meetings/${meetingId}/tasks`,
  { actionItemIds: ids },
  201,
);
check("行动项转成任务", createdTasks.data.tasks?.length === ids.length);
const boardAfter = (await call("GET", `/api/groups/${group.id}/board`, undefined, 200)).data;
const withMeeting = boardAfter.tasks.filter((task) => task.meetingId === meetingId);
check("任务回填 meeting_id", withMeeting.length === ids.length, `${withMeeting.length}/${ids.length}`);

const again = await call(
  "POST",
  `/api/meetings/${meetingId}/tasks`,
  { actionItemIds: ids },
  201,
);
check("重复转换被忽略（防重复建任务）", again.data.tasks.length === 0);

/* ---------------- 权限 ---------------- */
cookie = "";
const anonymous = await fetch(`${BASE}/api/groups/${group.id}/meetings`);
check("未登录不能访问会议列表（401）", anonymous.status === 401);

console.log(`\n结果：${passed} 项通过，${failures.length} 项失败\n`);
if (failures.length) {
  console.log("失败详情：\n" + failures.map((item) => "  - " + item).join("\n"));
  process.exit(1);
}
