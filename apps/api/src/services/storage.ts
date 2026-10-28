import { createReadStream, statSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  STORAGE_DIR,
  SUPABASE_BUCKET,
  SUPABASE_SERVICE_KEY,
  SUPABASE_URL,
} from "../config.ts";

/**
 * 文件存储层：支持两种后端，由环境变量决定。
 *
 * - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 都配置 → 存到 Supabase Storage 桶
 * - 否则 → 存到本地磁盘（DATA_DIR/storage，Railway 上就是挂载的 /data 卷）
 *
 * 这样本地开发不需要任何云服务也能跑；线上想要"文件不占容器磁盘"就配上 Supabase。
 */
export type StorageDriver = "supabase" | "local";

export const STORAGE_DRIVER: StorageDriver =
  SUPABASE_URL && SUPABASE_SERVICE_KEY ? "supabase" : "local";

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** 桶不存在时给出可操作的报错，而不是把 Supabase 的英文原文抛给用户 */
function explain(error: { message?: string } | null, action: string): Error {
  const message = error?.message ?? "";
  if (/bucket.*not.*found|not found/i.test(message)) {
    return new Error(
      `Supabase 桶「${SUPABASE_BUCKET}」不存在，请在 Supabase 控制台 Storage 里创建它（${action}失败）`,
    );
  }
  return new Error(`Supabase ${action}失败：${message || "未知错误"}`);
}

/** 上传本地临时文件到云端，返回对象路径 */
export async function uploadObject(
  objectKey: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  const { size } = statSync(filePath);
  const body = createReadStream(filePath);
  const { error } = await supabase()
    .storage.from(SUPABASE_BUCKET)
    .upload(objectKey, body as unknown as Blob, {
      contentType,
      upsert: true,
      duplex: "half",
      // 大文件一次性流式上传，避免把 200MB 读进内存
      headers: { "content-length": String(size) },
    } as never);

  if (error) throw explain(error, "上传");
}

/** 公网 URL（仅当桶是 public 时可直接访问；private 桶请用 createSignedUrl） */
export function publicObjectUrl(objectKey: string): string {
  const { data } = supabase().storage.from(SUPABASE_BUCKET).getPublicUrl(objectKey);
  return data.publicUrl;
}

/** 临时签名 URL：private 桶也能访问，默认 60 秒 */
export async function signedObjectUrl(
  objectKey: string,
  expiresInSeconds = 60,
): Promise<string> {
  const { data, error } = await supabase()
    .storage.from(SUPABASE_BUCKET)
    .createSignedUrl(objectKey, expiresInSeconds);
  if (error || !data?.signedUrl) throw explain(error, "生成下载链接");
  return data.signedUrl;
}

/** 删除云端对象（文件不存在时静默成功） */
export async function removeObject(objectKey: string): Promise<void> {
  const { error } = await supabase().storage.from(SUPABASE_BUCKET).remove([objectKey]);
  if (error) throw explain(error, "删除文件");
}

/** 后端代理下载：拿到云端字节流（避免把签名 URL 直接暴露给前端） */
export async function fetchObject(url: string): Promise<Response> {
  return fetch(url);
}

/** 存储后端自检信息（/api/health 与文件列表都会用到） */
export function storageInfo(): {
  driver: StorageDriver;
  bucket: string | null;
  localDir: string | null;
} {
  return {
    driver: STORAGE_DRIVER,
    bucket: STORAGE_DRIVER === "supabase" ? SUPABASE_BUCKET : null,
    localDir: STORAGE_DRIVER === "local" ? STORAGE_DIR : null,
  };
}
