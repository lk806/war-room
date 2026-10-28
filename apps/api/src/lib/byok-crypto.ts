import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AUTH_SECRET } from "../config.ts";

/**
 * 用户自带的 API Key 加密存储（AES-256-GCM）。
 *
 * 存储格式：`enc:v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`
 * 密钥从 AUTH_SECRET（或独立的 KEY_ENC_SECRET）派生。
 *
 * 注意：交换 AUTH_SECRET 会导致已存的用户 Key 无法解密——
 * 解密失败时按「未配置」处理，不会让登录/调用崩掉。
 */
const KEY_ENV = (process.env.KEY_ENC_SECRET ?? AUTH_SECRET ?? "").trim();

/** 从主密钥派生 32 字节加密密钥 */
function derivedKey(): Buffer {
  return createHash("sha256").update(`war-room:byok:${KEY_ENV}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/** 解密失败（密钥换了 / 数据被篡改）返回 null，由调用方按「未配置」处理 */
export function decryptSecret(payload: string | null): string | null {
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[2]!, "base64");
    const tag = Buffer.from(parts[3]!, "base64");
    const data = Buffer.from(parts[4]!, "base64");
    const decipher = createDecipheriv("aes-256-gcm", derivedKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return plain || null;
  } catch {
    return null;
  }
}

/** 脱敏展示：sk-abcdef…5899 */
export function maskKey(plain: string): string {
  const trimmed = plain.trim();
  if (trimmed.length <= 10) return "****";
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}
