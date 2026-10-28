import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "../config.ts";

export type SqlValue = string | number | bigint | null | Uint8Array;

export const db = new DatabaseSync(DB_PATH);

// WAL 提升并发读写表现；外键约束保证级联删除生效
try {
  db.exec("PRAGMA journal_mode = WAL");
} catch {
  /* 某些文件系统不支持 WAL，退回默认日志模式即可 */
}
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

const schemaPath = path.join(import.meta.dirname, "schema.sql");
db.exec(fs.readFileSync(schemaPath, "utf8"));

/**
 * 轻量迁移：老库补列。P2 之前建的 war-room.db 没有 meeting 的新字段，
 * 这里幂等地补上，避免用户删库重来。
 */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn("users", "can_use_ai", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "user_deepseek_key", "TEXT");
ensureColumn("files", "storage_driver", "TEXT NOT NULL DEFAULT 'local'");
ensureColumn("meetings", "action_items_json", "TEXT");
ensureColumn("meetings", "error", "TEXT");
ensureColumn("meetings", "engine", "TEXT");
ensureColumn("meetings", "audio_mime", "TEXT");

/** 查询多行 */
export function all<T>(sql: string, ...params: SqlValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

/** 查询单行 */
export function get<T>(sql: string, ...params: SqlValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

/** 执行写入，返回受影响行数与自增 ID */
export function run(
  sql: string,
  ...params: SqlValue[]
): { changes: number | bigint; lastInsertRowid: number | bigint } {
  return db.prepare(sql).run(...params);
}

/** 同步事务：回调内抛错则整体回滚 */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
