import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MAX_FILE_BYTES } from "@war-room/shared";

const apiRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(apiRoot, "..", "..");

/**
 * 读数字型环境变量并兜底。
 * 手误写成 `REMINDER_SWEEP_MS=60s` 这种值时，直接进 setInterval 会变成 1ms 一次的忙循环。
 */
export function numberEnv(name: string, fallback: number, min = 1): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw < min) {
    if (process.env[name] !== undefined) {
      console.warn(`[config] 环境变量 ${name}=${process.env[name]} 无效，已回退到 ${fallback}`);
    }
    return fallback;
  }
  return Math.floor(raw);
}

export const PORT = numberEnv("PORT", 4000, 1);
export const HOST = process.env.HOST ?? "0.0.0.0";

/**
 * AI 功能授权码：用户在「设置」页输入它来解锁纪要 / 任务拆分（走平台公用 Key）。
 * - 开发环境：没配就用内置默认码 war-room-vip，方便本地演示
 * - **生产环境：必须显式配置**，否则关闭自助开通（防止任何人用公开的默认码白嫖平台额度），
 *   此时用户只能自己配 DeepSeek Key（BYOK）或由管理员用 `npm run grant:ai` 开通。
 */
const DEFAULT_AI_ACTIVATION_CODE = "war-room-vip";

/** 环境变量里是否显式配置了授权码（用于诊断 .env 有没有被读到） */
export const AI_ACTIVATION_FROM_ENV = process.env.AI_ACTIVATION_CODE !== undefined;

export const AI_ACTIVATION_CODE = (
  process.env.AI_ACTIVATION_CODE ??
  (process.env.NODE_ENV === "production" ? "" : DEFAULT_AI_ACTIVATION_CODE)
).trim();

/** 是否在使用内置默认码：为 true 说明 .env 里没配（或服务没重启） */
export const AI_ACTIVATION_USING_DEFAULT = !AI_ACTIVATION_FROM_ENV && AI_ACTIVATION_CODE.length > 0;

/**
 * 单文件上限：默认 200MB（与 packages/shared 的 MAX_FILE_BYTES 一致），可用 MAX_UPLOAD_BYTES 覆盖。
 * multipart 的 fileSize 与写入时的字节计数都用这个值。
 */
export const MAX_UPLOAD_BYTES = numberEnv("MAX_UPLOAD_BYTES", MAX_FILE_BYTES, 1024);

/** 运行期数据目录（SQLite 文件、上传文件、密钥），已加入 .gitignore */
export const DATA_DIR = process.env.DATA_DIR ?? path.join(apiRoot, "data");
export const STORAGE_DIR = path.join(DATA_DIR, "storage");
export const DB_PATH = path.join(DATA_DIR, "war-room.db");
export const WEB_DIST = path.join(repoRoot, "apps", "web", "dist");

export const SESSION_COOKIE = "wr_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** 部署到 HTTPS 平台时用 NODE_ENV=production 开启 */
export const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * 会话 Cookie 是否加 Secure：
 * 生产默认 true（只走 HTTPS）；本地用 http 调试时可显式设置 COOKIE_SECURE=false 覆盖。
 */
export const COOKIE_SECURE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === "true"
  : IS_PRODUCTION;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STORAGE_DIR, { recursive: true });

/**
 * 会话签名密钥：优先读环境变量；否则在 data/ 下生成并持久化一个，
 * 这样重启服务不会把所有用户踢下线。
 */
export const AUTH_SECRET = (() => {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const file = path.join(DATA_DIR, ".auth-secret");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
})();

/**
 * 大模型 / 语音识别配置（OpenAI 兼容协议）。
 * 未配置 AI_API_KEY 时自动进入演示模式：接口结构、状态机、页面完全一致，
 * 只是内容来自内置样例，方便无网络/无预算时演示与测试。
 */
export const AI_CONFIG = {
  baseUrl: (process.env.AI_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, ""),
  apiKey: process.env.AI_API_KEY ?? "",
  model: process.env.AI_MODEL ?? "deepseek-chat",
  timeoutMs: numberEnv("AI_TIMEOUT_MS", 45_000, 1000),

  asrBaseUrl: (process.env.ASR_BASE_URL ?? "").replace(/\/$/, ""),
  asrApiKey: process.env.ASR_API_KEY ?? "",
  asrModel: process.env.ASR_MODEL ?? "whisper-1",
  asrTimeoutMs: numberEnv("ASR_TIMEOUT_MS", 120_000, 1000),

  forceMock: (process.env.AI_PROVIDER ?? "").toLowerCase() === "mock",
};

