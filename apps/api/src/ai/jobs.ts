import { newId, nowIso } from "../lib/id.ts";
import { run } from "../db/index.ts";

export type JobKind = "ASR" | "SPLIT" | "SUMMARY";
export type JobStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

/** 建一条 AI 任务记录，便于追踪成本与失败原因 */
export function createJob(
  kind: JobKind,
  groupId: string,
  userId: string,
  input: unknown,
): string {
  const id = newId();
  run(
    `INSERT INTO ai_jobs (id, group_id, kind, status, input_json, created_by, created_at)
     VALUES (?, ?, ?, 'RUNNING', ?, ?, ?)`,
    id,
    groupId,
    kind,
    JSON.stringify(input),
    userId,
    nowIso(),
  );
  return id;
}

export function finishJob(
  id: string,
  result:
    | { ok: true; output: unknown; tokens?: number }
    | { ok: false; error: string },
): void {
  if (result.ok) {
    run(
      `UPDATE ai_jobs SET status = 'SUCCESS', output_json = ?, token_usage = ?, finished_at = ?
       WHERE id = ?`,
      JSON.stringify(result.output).slice(0, 20000),
      result.tokens ?? 0,
      nowIso(),
      id,
    );
    return;
  }
  run(
    `UPDATE ai_jobs SET status = 'FAILED', error = ?, finished_at = ? WHERE id = ?`,
    result.error.slice(0, 500),
    nowIso(),
    id,
  );
}
