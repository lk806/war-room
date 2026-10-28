import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  ActionItem,
  CreateMeetingInput,
  Meeting,
  MeetingStatus,
  Task,
  Transcript,
  TranscriptSegment,
} from "@war-room/shared";
import { aiStatus, asrEngine, textEngine, transcribeAudio } from "../ai/client.ts";
import { createJob, finishJob } from "../ai/jobs.ts";
import { mockMinutes, mockTranscript } from "../ai/mock.ts";
import { minutesMessages } from "../ai/prompts.ts";
import { STORAGE_DIR } from "../config.ts";
import { sniffAudioMagic } from "./files.ts";
import { all, get, run } from "../db/index.ts";
import type { LlmCredential } from "../lib/ai-credential.ts";
import { ApiError, badRequest, notFound } from "../lib/http.ts";
import { newId, nowIso } from "../lib/id.ts";
import { requireMember, recordContribution } from "./groups.ts";
import { publish } from "./realtime.ts";
import { createTask } from "./tasks.ts";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 会议音频单独限制 100MB

interface MeetingRow {
  id: string;
  group_id: string;
  title: string;
  started_at: string;
  duration_sec: number;
  audio_key: string | null;
  audio_mime: string | null;
  status: MeetingStatus;
  transcript_json: string | null;
  minutes_markdown: string | null;
  action_items_json: string | null;
  error: string | null;
  engine: string | null;
  created_by: string;
  created_at: string;
  created_by_name: string;
}

const SELECT_MEETING = `
  SELECT m.*, u.name AS created_by_name
    FROM meetings m
    JOIN users u ON u.id = m.created_by
`;

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toMeeting(row: MeetingRow): Meeting {
  const engine = row.engine === "remote" ? "remote" : "mock";
  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    startedAt: row.started_at,
    durationSec: row.duration_sec,
    status: row.status,
    hasAudio: Boolean(row.audio_key),
    audioUrl: row.audio_key ? `/api/meetings/${row.id}/audio` : null,
    transcript: parseJson<Transcript>(row.transcript_json),
    minutesMarkdown: row.minutes_markdown,
    actionItems: parseJson<ActionItem[]>(row.action_items_json) ?? [],
    error: row.error,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    engine,
  };
}

function getRow(meetingId: string): MeetingRow {
  const row = get<MeetingRow>(`${SELECT_MEETING} WHERE m.id = ?`, meetingId);
  if (!row) throw notFound("会议不存在");
  return row;
}

export function listMeetings(groupId: string): Meeting[] {
  return all<MeetingRow>(
    `${SELECT_MEETING} WHERE m.group_id = ? ORDER BY m.started_at DESC`,
    groupId,
  ).map(toMeeting);
}

export function createMeeting(
  ctx: { groupId: string; userId: string },
  input: CreateMeetingInput,
): Meeting {
  requireMember(ctx.groupId, ctx.userId);
  const id = newId();
  const startedAt = input.startedAt ? new Date(input.startedAt).toISOString() : nowIso();

  run(
    `INSERT INTO meetings
       (id, group_id, title, started_at, duration_sec, status, created_by, created_at, engine)
     VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`,
    id,
    ctx.groupId,
    input.title,
    startedAt,
    input.durationSec ?? 0,
    ctx.userId,
    nowIso(),
    textEngine().engine,
  );

  return toMeeting(getRow(id));
}

/** 取会议并校验成员身份，返回 groupId 供广播使用 */
export function requireMeetingAccess(
  meetingId: string,
  userId: string,
): { meeting: Meeting; groupId: string } {
  const row = getRow(meetingId);
  requireMember(row.group_id, userId);
  return { meeting: toMeeting(row), groupId: row.group_id };
}

function memberNames(groupId: string): string[] {
  return all<{ name: string }>(
    `SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?
      ORDER BY CASE m.role WHEN 'LEADER' THEN 0 ELSE 1 END, m.joined_at ASC`,
    groupId,
  ).map((row) => row.name);
}

export interface UploadPart {
  file: NodeJS.ReadableStream;
  filename: string;
  mimetype: string;
}

/** 录音/音频落盘（内容寻址），返回存储键 */
async function saveAudio(part: UploadPart): Promise<{ key: string; mime: string }> {
  const tempPath = path.join(STORAGE_DIR, `.audio-${newId()}`);
  const hash = createHash("sha256");
  let size = 0;

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_AUDIO_BYTES) {
        callback(new ApiError(413, "音频超过 100MB 上限（会议录音请分段上传）"));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(part.file, meter, createWriteStream(tempPath));
  } catch (error) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    if (error instanceof ApiError) throw error;
    throw badRequest("音频上传中断，请重试");
  }

  if ((part.file as { truncated?: boolean }).truncated) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw new ApiError(413, "音频超过 100MB 上限（会议录音请分段上传）");
  }

  if (size === 0) {
    unlinkSync(tempPath);
    throw badRequest("音频为空，请重新录制");
  }

  // 只认真实音频内容：Content-Type 完全由上传方控制，
  // 不校验的话可以把 text/html 存进来，回放时在应用同源执行脚本（存储型 XSS）
  const head = Buffer.alloc(16);
  const handle = createReadStream(tempPath, { start: 0, end: 15 });
  await new Promise<void>((resolve, reject) => {
    let offset = 0;
    handle.on("data", (chunk: Buffer) => {
      chunk.copy(head, offset);
      offset += chunk.length;
    });
    handle.on("end", () => resolve());
    handle.on("error", reject);
  });

  const realMime = sniffAudioMagic(head);
  if (!realMime) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw new ApiError(415, "只支持音频文件（webm / ogg / mp3 / wav / m4a）");
  }

  const key = `audio-${hash.digest("hex")}`;
  const target = path.join(STORAGE_DIR, key);
  if (existsSync(target)) unlinkSync(tempPath);
  else renameSync(tempPath, target);

  // 存真实 MIME，而不是客户端声明的
  return { key, mime: realMime };
}

export function audioPath(meetingId: string): { absolute: string; mime: string; size: number } {
  const row = getRow(meetingId);
  if (!row.audio_key) throw notFound("这场会议还没有音频");
  const absolute = path.join(STORAGE_DIR, path.basename(row.audio_key));
  if (!existsSync(absolute)) throw notFound("音频文件已丢失，请重新上传");
  const size = statSync(absolute).size;
  return { absolute, mime: row.audio_mime ?? "audio/webm", size };
}

/** 上传/录制音频后调用：落盘 + 进入转写队列 */
export async function attachAudio(
  meetingId: string,
  userId: string,
  part: UploadPart,
  durationSec: number,
): Promise<Meeting> {
  const { groupId } = requireMeetingAccess(meetingId, userId);
  const { key, mime } = await saveAudio(part);

  run(
    `UPDATE meetings
        SET audio_key = ?, audio_mime = ?, duration_sec = ?, status = 'TRANSCRIBING',
            error = NULL, transcript_json = NULL, minutes_markdown = NULL,
            action_items_json = NULL, engine = ?
      WHERE id = ?`,
    key,
    mime,
    Math.min(Math.max(Math.round(durationSec), 0), 6 * 3600),
    asrEngine().engine,
    meetingId,
  );

  const meeting = toMeeting(getRow(meetingId));
  publish(groupId, { type: "meeting.updated", meetingId, status: "TRANSCRIBING" });
  return meeting;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 异步转写：真实模式调用 ASR 接口，演示模式用内置逐字稿（带 600ms 延迟，
 * 让「转写中」状态在页面上可见）。任何失败都会落到 FAILED + error 字段。
 */
/**
 * 有些 ASR（如 SiliconFlow 的 SenseVoice）只返回整段文本、不给时间戳。
 * 这里按句号/问号/分号切成句子，并按字数占比估算时间轴，
 * 让逐字稿至少能一段一行地读（时间戳是估算值）。
 */
export function splitTranscriptSentences(
  text: string,
  durationSec: number,
): TranscriptSegment[] {
  const sentences = text
    .split(/(?<=[。！？!?；;\n])/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    return [{ start: 0, end: Math.max(0, durationSec), speaker: "发言人", text: text.trim() }];
  }

  const total = sentences.reduce((sum, sentence) => sum + sentence.length, 0) || 1;
  let cursor = 0;
  return sentences.map((sentence) => {
    const span = durationSec > 0 ? (sentence.length / total) * durationSec : 0;
    const start = Math.round(cursor);
    cursor += span;
    return { start, end: Math.round(cursor), speaker: "发言人", text: sentence };
  });
}

export async function runTranscription(meetingId: string): Promise<void> {
  const row = getRow(meetingId);
  const jobId = createJob("ASR", row.group_id, row.created_by, {
    meetingId,
    audioKey: row.audio_key,
  });

  try {
    const engine = asrEngine().engine;
    let transcript: Transcript;

    if (engine === "mock") {
      await sleep(600);
      transcript = mockTranscript(row.title, memberNames(row.group_id));
    } else {
      const { absolute, mime } = audioPath(meetingId);
      const result = await transcribeAudio(absolute, `${meetingId}.webm`, mime);
      // 有分段就沿用，没有就按句子切（SenseVoice 这类只返回整段文本的模型）
      transcript = {
        text: result.text,
        segments:
          result.segments.length > 1
            ? result.segments.map((segment) => ({
                start: segment.start,
                end: segment.end,
                speaker: "发言人",
                text: segment.text,
              }))
            : splitTranscriptSentences(result.text, row.duration_sec),
      };
    }

    run(
      `UPDATE meetings
          SET status = 'TRANSCRIBED', transcript_json = ?, error = NULL, engine = ?
        WHERE id = ?`,
      JSON.stringify(transcript),
      engine,
      meetingId,
    );
    finishJob(jobId, { ok: true, output: { segments: transcript.segments.length } });
    publish(row.group_id, { type: "meeting.updated", meetingId, status: "TRANSCRIBED" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "转写失败";
    run(`UPDATE meetings SET status = 'FAILED', error = ? WHERE id = ?`, message, meetingId);
    finishJob(jobId, { ok: false, error: message });
    publish(row.group_id, { type: "meeting.updated", meetingId, status: "FAILED" });
  }
}

const minutesSchema = {
  summary: "",
  decisions: [] as string[],
  risks: [] as string[],
  markdown: "",
  actionItems: [] as {
    title: string;
    detail: string;
    suggestedAssigneeName: string | null;
    suggestedDueOffsetDays: number;
  }[],
};

function normalizeMinutes(
  raw: Partial<typeof minutesSchema>,
): typeof minutesSchema {
  const list = (value: unknown, max: number): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, max)
      : [];

  return {
    summary: (raw.summary ?? "").toString().trim().slice(0, 600),
    decisions: list(raw.decisions, 6),
    risks: list(raw.risks, 5),
    markdown: (raw.markdown ?? "").toString().slice(0, 8000),
    actionItems: (Array.isArray(raw.actionItems) ? raw.actionItems : [])
      .filter((item) => item && typeof item.title === "string" && item.title.trim())
      .slice(0, 8)
      .map((item) => ({
        title: item.title.trim().slice(0, 80),
        detail: (item.detail ?? "").toString().trim().slice(0, 300),
        suggestedAssigneeName:
          typeof item.suggestedAssigneeName === "string" && item.suggestedAssigneeName.trim()
            ? item.suggestedAssigneeName.trim().slice(0, 24)
            : null,
        suggestedDueOffsetDays: Number.isFinite(Number(item.suggestedDueOffsetDays))
          ? Math.min(Math.max(Math.round(Number(item.suggestedDueOffsetDays)), 1), 14)
          : 3,
      })),
  };
}

async function requestMinutes(
  title: string,
  transcript: Transcript,
  members: string[],
  endpoint: { apiKey: string; baseUrl: string; model: string },
): Promise<{ payload: ReturnType<typeof normalizeMinutes>; tokens: number }> {
  const { chatJSON, extractJson } = await import("../ai/client.ts");
  let lastError = "";
  let tokens = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages = minutesMessages({ title, transcriptText: transcript.text, memberNames: members });
    if (attempt > 0) {
      messages.push({
        role: "user",
        content: `上一次输出不符合要求：${lastError}。请只输出符合结构的 JSON。`,
      });
    }
    const result = await chatJSON(messages, { temperature: 0.2, maxTokens: 1800, endpoint });
    tokens += result.tokens;

    try {
      const parsed = JSON.parse(extractJson(result.content)) as Partial<typeof minutesSchema>;
      const normalized = normalizeMinutes(parsed);
      if (!normalized.summary && !normalized.markdown && normalized.actionItems.length === 0) {
        throw new Error("缺少 summary / markdown / actionItems");
      }
      return { payload: normalized, tokens };
    } catch (error) {
      lastError = (error as Error).message.slice(0, 200);
    }
  }

  throw new ApiError(502, "大模型没有给出可用的纪要，请重试");
}

/** 模型输出的行动项 -> 存档结构（种子数据也复用） */
export function buildActionItems(
  items: {
    title: string;
    detail: string;
    suggestedAssigneeName: string | null;
    suggestedDueOffsetDays: number;
  }[],
): ActionItem[] {
  const now = Date.now();
  return items.map((item) => ({
    id: newId(),
    title: item.title,
    detail: item.detail,
    suggestedAssigneeName: item.suggestedAssigneeName,
    suggestedDueAt: new Date(now + item.suggestedDueOffsetDays * 86_400_000).toISOString(),
    status: "PENDING",
    taskId: null,
  }));
}

/** 兜底拼 Markdown（模型没给 markdown 时用） */
export function buildMarkdown(
  title: string,
  payload: ReturnType<typeof normalizeMinutes>,
): string {  if (payload.markdown.trim()) return payload.markdown;
  return [
    `# ${title}`,
    "",
    "## 摘要",
    "",
    payload.summary || "（未生成）",
    "",
    "## 决议",
    "",
    ...(payload.decisions.length ? payload.decisions.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "## 行动项",
    "",
    ...(payload.actionItems.length
      ? payload.actionItems.map(
          (item, index) =>
            `${index + 1}. **${item.title}** — ${item.detail}（建议：${item.suggestedAssigneeName ?? "待定"}，${item.suggestedDueOffsetDays} 天内）`,
        )
      : ["- 无"]),
    "",
    "## 风险",
    "",
    ...(payload.risks.length ? payload.risks.map((item) => `- ${item}`) : ["- 无"]),
  ].join("\n");
}

/** 生成纪要 + 行动项（同步接口，前端按钮 loading） */
export async function generateMinutes(
  meetingId: string,
  actorId: string,
  credential: LlmCredential,
): Promise<Meeting> {
  const row = getRow(meetingId);
  requireMember(row.group_id, actorId);

  const transcript = parseJson<Transcript>(row.transcript_json);
  if (!transcript || !transcript.text.trim()) {
    throw badRequest("还没有逐字稿，请先完成语音转写");
  }

  const members = memberNames(row.group_id);
  const engine = credential.mode === "remote" ? "remote" : "mock";
  const jobId = createJob("SUMMARY", row.group_id, actorId, { meetingId });

  try {
    const result =
      credential.mode === "mock"
        ? { payload: normalizeMinutes(mockMinutes(row.title, transcript, members)), tokens: 0 }
        : await requestMinutes(row.title, transcript, members, {
            apiKey: credential.apiKey,
            baseUrl: credential.baseUrl,
            model: credential.model,
          });

    const actionItems = buildActionItems(result.payload.actionItems);

    const markdown = buildMarkdown(row.title, result.payload);

    run(
      `UPDATE meetings
          SET status = 'SUMMARIZED', minutes_markdown = ?, action_items_json = ?, error = NULL, engine = ?
        WHERE id = ?`,
      markdown,
      JSON.stringify(actionItems),
      engine,
      meetingId,
    );
    finishJob(jobId, {
      ok: true,
      output: { actionItems: actionItems.length, engine },
      tokens: result.tokens,
    });
    // 参会贡献：生成纪要的人记一次「参加会议」（同一场会议只记一次）
    const alreadyAttended = get<{ id: string }>(
      `SELECT id FROM contribution_events
        WHERE ref_type = 'meeting' AND ref_id = ? AND kind = 'meeting_attended' AND user_id = ?`,
      meetingId,
      actorId,
    );
    if (!alreadyAttended) {
      recordContribution(row.group_id, actorId, "meeting_attended", "meeting", meetingId, {
        title: row.title,
      });
    }
    publish(row.group_id, { type: "meeting.updated", meetingId, status: "SUMMARIZED" });

    return toMeeting(getRow(meetingId));
  } catch (error) {
    finishJob(jobId, {
      ok: false,
      error: error instanceof Error ? error.message : "纪要生成失败",
    });
    throw error;
  }
}

/** 人工修订逐字稿：整段替换，并把分段压缩为一条 */
export function updateTranscript(
  meetingId: string,
  userId: string,
  text: string,
): Meeting {
  const row = getRow(meetingId);
  requireMember(row.group_id, userId);

  const segments: TranscriptSegment[] = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^([^：:]{1,12})[：:]\s*(.*)$/);
      return {
        start: index * 15,
        end: index * 15 + 15,
        speaker: match?.[1]?.trim() || "发言人",
        text: match?.[2]?.trim() || line,
      };
    });

  run(
    `UPDATE meetings SET transcript_json = ?, status = CASE WHEN status = 'FAILED' THEN 'TRANSCRIBED' ELSE status END
      WHERE id = ?`,
    JSON.stringify({ text, segments }),
    meetingId,
  );

  const meeting = toMeeting(getRow(meetingId));
  publish(meeting.groupId, {
    type: "meeting.updated",
    meetingId,
    status: meeting.status,
  });
  return meeting;
}

/** 勾选的行动项 -> 任务（写回 meeting_id，回填 taskId 防重复） */
export function createTasksFromActionItems(
  meetingId: string,
  userId: string,
  actionItemIds: string[],
): Task[] {
  const row = getRow(meetingId);
  requireMember(row.group_id, userId);

  const items = parseJson<ActionItem[]>(row.action_items_json) ?? [];
  if (items.length === 0) throw badRequest("这场会议还没有行动项，请先生成纪要");

  const members = all<{ id: string; name: string }>(
    `SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?`,
    row.group_id,
  );

  const created: Task[] = [];

  for (const id of actionItemIds) {
    const item = items.find((entry) => entry.id === id);
    if (!item || item.status === "CONVERTED") continue;

    const assignee = item.suggestedAssigneeName
      ? members.find((member) => member.name === item.suggestedAssigneeName)
      : undefined;

    const task = createTask(
      { groupId: row.group_id, userId },
      {
        title: item.title,
        description: [item.detail, `来自会议「${row.title}」`].filter(Boolean).join("\n\n"),
        priority: "MEDIUM",
        status: "TODO",
        assigneeId: assignee?.id ?? null,
        dueAt: item.suggestedDueAt,
        estimateHours: null,
      },
      { meetingId },
    );

    item.status = "CONVERTED";
    item.taskId = task.id;
    created.push(task);
  }

  if (created.length > 0) {
    run(
      `UPDATE meetings SET action_items_json = ? WHERE id = ?`,
      JSON.stringify(items),
      meetingId,
    );
    // 「确认纪要」：把行动项落成任务，同一场会议只记一次
    const confirmed = get<{ id: string }>(
      `SELECT id FROM contribution_events
        WHERE ref_type = 'meeting' AND ref_id = ? AND kind = 'minutes_confirmed' AND user_id = ?`,
      meetingId,
      userId,
    );
    if (!confirmed) {
      recordContribution(row.group_id, userId, "minutes_confirmed", "meeting", meetingId, {
        title: row.title,
      });
    }
  }

  return created;
}

export function deleteMeeting(meetingId: string, userId: string): void {
  const row = getRow(meetingId);
  requireMember(row.group_id, userId);
  run("DELETE FROM meetings WHERE id = ?", meetingId);
  publish(row.group_id, { type: "meeting.updated", meetingId, status: "DRAFT" });
}

export const meetingAiStatus = aiStatus;

/**
 * 启动自愈：进程重启时，正在转写的会议和 RUNNING 的 AI 任务永远等不到结果，
 * 会把页面卡在「转写中」（前端还会一直轮询）。启动时统一标记为失败。
 */
export function recoverStaleJobs(): { meetings: number; jobs: number } {
  const meetings = run(
    `UPDATE meetings
        SET status = 'FAILED', error = '服务重启导致转写中断，请重新转写或重新上传音频'
      WHERE status = 'TRANSCRIBING'`,
  );
  const jobs = run(
    `UPDATE ai_jobs
        SET status = 'FAILED', error = '服务重启导致任务中断', finished_at = ?
      WHERE status IN ('PENDING', 'RUNNING')`,
    nowIso(),
  );
  return {
    meetings: Number(meetings.changes ?? 0),
    jobs: Number(jobs.changes ?? 0),
  };
}
