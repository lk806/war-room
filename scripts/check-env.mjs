/**
 * 环境变量自检：确认 .env 是否真的被加载、AI 相关变量是否生效。
 * 只打印脱敏值（前 4 位 + 后 4 位），避免把 Key 泄露到终端历史/录屏里。
 *
 * 用法：npm run env:check
 */
import fs from "node:fs";
import path from "node:path";

const VARS = [
  { key: "AI_PROVIDER", desc: "=mock 时强制演示模式" },
  { key: "AI_API_KEY", desc: "文本模型 Key（缺省则走演示模式）" },
  { key: "AI_BASE_URL", desc: "默认 https://api.deepseek.com/v1" },
  { key: "AI_MODEL", desc: "默认 deepseek-chat" },
  { key: "ASR_API_KEY", desc: "语音识别 Key（缺省则转写走样例）" },
  { key: "ASR_BASE_URL", desc: "语音识别 Base URL" },
  { key: "ASR_MODEL", desc: "默认 whisper-1" },
  { key: "PORT", desc: "接口端口，默认 4000" },
  { key: "DATA_DIR", desc: "数据目录，默认 apps/api/data" },
  { key: "REMINDER_SWEEP_MS", desc: "提醒扫描间隔，默认 60000" },
];

const mask = (value) => {
  if (!value) return "";
  return value.length <= 8
    ? "*".repeat(value.length)
    : `${value.slice(0, 4)}…${value.slice(-4)}`;
};

const envFiles = [
  path.resolve(".env"),
  path.resolve("apps/api/.env"),
];

console.log("\n📄 .env 文件检测（相对仓库根目录）\n");
let foundEnv = false;
for (const file of envFiles) {
  const exists = fs.existsSync(file);
  if (exists) foundEnv = true;
  console.log(
    `  ${exists ? "✅" : "— "} ${path.relative(process.cwd(), file) || file}` +
      (exists ? `（${fs.statSync(file).size} 字节）` : "（不存在）"),
  );
}
if (!foundEnv) {
  console.log("\n  没有找到 .env：可以复制 .env.example 为 .env 再填 Key。");
}

const inShell = process.env.AI_API_KEY;

console.log("\n🔧 当前进程看到的环境变量\n");
console.log("  " + "变量".padEnd(20) + "状态".padEnd(26) + "说明");
console.log("  " + "-".repeat(78));
for (const { key, desc } of VARS) {
  const value = process.env[key];
  const state = value ? `已设置 ${mask(value)}` : "未设置";
  console.log(`  ${key.padEnd(20)}${state.padEnd(26)}${desc}`);
}

// 用与后端一致的口径判断引擎（见 apps/api/src/ai/client.ts）
const forceMock = (process.env.AI_PROVIDER ?? "").toLowerCase() === "mock";
const textEngine = forceMock ? "mock" : process.env.AI_API_KEY ? "remote" : "mock";
const asrEngine =
  forceMock || !process.env.ASR_BASE_URL || !process.env.ASR_API_KEY ? "mock" : "remote";

console.log("\n🧠 引擎判定（与 config.ts / ai/client.ts 一致）\n");
console.log(`  文本模型：${textEngine === "remote" ? "remote（真实 API）" : "mock（内置样例）"}`);
console.log(`  语音识别：${asrEngine === "remote" ? "remote（真实 API）" : "mock（内置样例）"}`);

if (textEngine === "mock") {
  console.log(
    "\n  提示：要接真实模型，至少设置 AI_API_KEY；语音识别还需要 ASR_BASE_URL + ASR_API_KEY。",
  );
}

console.log("\n🔍 想看单个变量（同样脱敏）：\n");
console.log(
  '  node --env-file-if-exists=.env -e "const v=process.env.AI_API_KEY; console.log(v ? v.slice(0,4)+\'…\'+v.slice(-4) : \'未设置\')"',
);
console.log(
  "\n  ⚠️ 不要直接 console.log 完整 Key：终端历史、录屏、日志文件都会留下明文。\n",
);

if (inShell !== process.env.AI_API_KEY) {
  // 理论上不会发生，仅做防御
  console.log("  （警告：环境变量在运行期发生变化）");
}
