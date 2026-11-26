import { statfsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { MIN_FREE_BYTES, FILE_RETENTION_DAYS, STORAGE_DIR } from "../config.ts";
import { all, get, run } from "../db/index.ts";
import { ApiError } from "../lib/http.ts";
import { publish } from "./realtime.ts";

/**
 * 存储治理：
 *  1. 磁盘水位保护——剩余空间低于 MIN_FREE_BYTES 时拒绝上传，避免把系统盘写满导致整站挂掉
 *  2. 文件保留期——超过 FILE_RETENTION_DAYS 天的文件自动清理（内容寻址，共享内容不会误删）
 */

/** 剩余磁盘空间（字节）；平台不支持 statfs 时返回 null（视为不限制） */
export function freeDiskBytes(): number | null {
  try {
    const stats = statfsSync(STORAGE_DIR);
    return Number(stats.bsize) * Number(stats.bavail);
  } catch {
    return null;
  }
}

/** 上传前调用：磁盘快满时直接拒绝 */
export function assertDiskSpace(): void {
  const free = freeDiskBytes();
  if (free === null) return;
  if (free < MIN_FREE_BYTES) {
    throw new ApiError(
      507,
      `服务器存储空间不足（仅剩 ${Math.round(free / 1024 / 1024)} MB），请联系管理员清理后再上传`,
    );
  }
}

interface ExpiredRow {
  id: string;
  group_id: string;
  name: string;
  storage_key: string;
  storage_driver: string;
  created_at: string;
}

/**
 * 清理超过保留期的文件。
 * - 先删本地磁盘对象：只有当没有其他记录引用同一份内容（同一个 sha256）时才真正删
 * - contribution_events 保留（贡献分不该因为文件过期而回溯变化）
 * - 每个被删的文件通过 SSE 通知组内页面刷新
 */
export function sweepExpiredFiles(now = Date.now()): number {
  if (FILE_RETENTION_DAYS <= 0) return 0;

  const cutoff = new Date(now - FILE_RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
  const rows = all<ExpiredRow>(
    `SELECT id, group_id, name, storage_key, storage_driver, created_at
       FROM files WHERE created_at < ?`,
    cutoff,
  );
  if (rows.length === 0) return 0;

  let removed = 0;
  for (const row of rows) {
    run("DELETE FROM files WHERE id = ?", row.id);

    if (row.storage_driver === "local") {
      const shared = get<{ id: string }>(
        "SELECT id FROM files WHERE storage_key = ? LIMIT 1",
        row.storage_key,
      );
      if (!shared) {
        try {
          unlinkSync(path.join(STORAGE_DIR, path.basename(row.storage_key)));
        } catch {
          /* 文件已不存在时忽略 */
        }
      }
    }

    publish(row.group_id, { type: "file.deleted", fileId: row.id });
    removed += 1;
  }

  return removed;
}
