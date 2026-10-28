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
import {
  formatFileLimit,
  isBlockedFileExtension,
  type FileItem,
} from "@war-room/shared";
import { MAX_UPLOAD_BYTES, STORAGE_DIR } from "../config.ts";
import { all, get, run } from "../db/index.ts";
import { ApiError, badRequest, forbidden, notFound } from "../lib/http.ts";
import { newId, nowIso } from "../lib/id.ts";
import { requireMember, recordContribution } from "./groups.ts";
import { publish } from "./realtime.ts";

interface FileRow {
  id: string;
  group_id: string;
  uploader_id: string;
  name: string;
  mime: string;
  size: number;
  storage_key: string;
  version: number;
  task_id: string | null;
  download_count: number;
  created_at: string;
  uploader_name: string;
  uploader_color: string;
  task_title: string | null;
}

const SELECT_FILES = `
  SELECT f.id, f.group_id, f.uploader_id, f.name, f.mime, f.size, f.storage_key,
         f.version, f.task_id, f.download_count, f.created_at,
         u.name AS uploader_name, u.avatar_color AS uploader_color,
         t.title AS task_title
    FROM files f
    JOIN users u ON u.id = f.uploader_id
    LEFT JOIN tasks t ON t.id = f.task_id
`;

const toItem = (row: FileRow): FileItem => ({
  id: row.id,
  groupId: row.group_id,
  uploaderId: row.uploader_id,
  uploaderName: row.uploader_name,
  uploaderColor: row.uploader_color,
  name: row.name,
  mime: row.mime,
  size: row.size,
  version: row.version,
  taskId: row.task_id,
  taskTitle: row.task_title,
  downloadCount: row.download_count,
  createdAt: row.created_at,
});

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  bmp: "image/bmp",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
  ipynb: "application/json",
  py: "text/x-python",
  js: "text/javascript",
  ts: "text/typescript",
};

/**
 * 文件名清洗：只去掉路径分隔符和控制字符，其余（空格、括号、#、&、@、中文、emoji…）
 * 原样保留，保证「下载下来还是原来那个名字」。
 */
function sanitizeName(raw: string): string {
  const base = path
    .basename(raw ?? "")
    // 控制字符 + 路径分隔符（\ / 以及 Windows 保留的 < > : " | ? * 只影响落盘，这里是展示名，保留即可）
    // 去掉控制字符、路径分隔符，以及 bidi/零宽控制符（U+202E 之类可把 .exe 伪装成 .png）
    .replace(/[\u0000-\u001f\u007f/\\\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    .trim();
  if (!base || base === "." || base === "..") return "未命名文件";
  // 按字符（而不是 UTF-16 单元）截断，避免把 emoji 切坏
  return [...base].slice(0, 120).join("");
}

/**
 * 音频魔数：只认常见的几种，返回真实 MIME。
 * 会议音频的 Content-Type 由上传方完全控制，必须按内容判定，
 * 否则可以塞 text/html 进来，回放时在应用同源执行脚本。
 */
export function sniffAudioMagic(head: Buffer): string | null {
  const hex = head.subarray(0, 4).toString("hex");
  if (hex === "1a45dfa3") return "audio/webm"; // WebM / Matroska（Chrome 录音）
  if (hex === "4f676753") return "audio/ogg"; // "OggS"
  if (hex.startsWith("494433")) return "audio/mpeg"; // ID3v2
  if (hex.startsWith("fffb") || hex.startsWith("fff3") || hex.startsWith("fff2")) {
    return "audio/mpeg";
  }
  if (
    head.subarray(0, 4).toString("latin1") === "RIFF" &&
    head.subarray(8, 12).toString("latin1") === "WAVE"
  ) {
    return "audio/wav";
  }
  if (head.subarray(4, 8).toString("latin1") === "ftyp") return "audio/mp4"; // m4a / Safari 录音
  return null;
}

/** 可执行文件魔数：即使扩展名改过也要拦下来 */
function sniffExecutable(head: Buffer): boolean {
  if (head.subarray(0, 2).toString("latin1") === "MZ") return true; // Windows PE
  const hex = head.subarray(0, 4).toString("hex");
  if (hex === "7f454c46") return true; // ELF
  if (["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe"].includes(hex)) return true; // Mach-O
  return false;
}

/**
 * 魔数嗅探：返回识别到的 MIME，未识别返回 null。
 *
 * 注意 ISO-BMFF 容器（mp4 / mov / avif / heic）都以 `....ftyp` 开头，
 * 必须再看第 8–12 字节的 brand，否则会把 AVIF 图片误判成 mp4。
 */
function sniffMagic(head: Buffer): string | null {
  const hex = head.subarray(0, 8).toString("hex");

  if (head.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = head.subarray(8, 12).toString("latin1");
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }

  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("47494638")) return "image/gif";
  if (head.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (hex.startsWith("504b0304")) return "application/zip";
  if (head.subarray(0, 4).toString() === "RIFF") return "audio/wav";
  if (head.subarray(0, 2).toString() === "BM") return "image/bmp";
  if (hex.startsWith("494433")) return "audio/mpeg";
  if (hex.startsWith("25504446")) return "application/pdf";
  return null;
}

const ZIP_LIKE = new Set(["docx", "xlsx", "pptx", "zip", "ipynb", "7z"]);
const IMAGE_LIKE = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "bmp"]);
/** 这些类型有强特征，识别不出来就说明内容与扩展名不符 */
const STRICT_MAGIC = new Set([...IMAGE_LIKE, "pdf", ...ZIP_LIKE]);

/** 扩展名与真实内容是否一致（只在「扩展名声称了具体类型」时才校验） */
function assertMagic(ext: string, head: Buffer): void {
  if (sniffExecutable(head)) {
    throw new ApiError(415, "检测到可执行文件内容，出于安全考虑已拒绝");
  }

  const sniffed = sniffMagic(head);

  if (!sniffed) {
    // 未知类型：只有扩展名明确声称是图片/pdf/压缩包时才算「内容不符」
    if (STRICT_MAGIC.has(ext)) {
      throw new ApiError(415, "文件内容与扩展名不符，请确认文件未损坏");
    }
    return;
  }

  if (ext === "pdf" && sniffed !== "application/pdf") {
    throw new ApiError(415, "文件内容与扩展名不符（期望 PDF）");
  }
  if (IMAGE_LIKE.has(ext) && !sniffed.startsWith("image/")) {
    throw new ApiError(415, "文件内容与扩展名不符（期望图片）");
  }
  if (ZIP_LIKE.has(ext) && sniffed !== "application/zip") {
    throw new ApiError(415, "文件内容与扩展名不符（期望压缩包/Office 文档）");
  }
}

export interface UploadPart {
  file: NodeJS.ReadableStream;
  filename: string;
  mimetype: string;
}

export function listFiles(groupId: string): FileItem[] {
  return all<FileRow>(
    `${SELECT_FILES} WHERE f.group_id = ? ORDER BY f.created_at DESC`,
    groupId,
  ).map(toItem);
}

export async function saveUpload(
  ctx: { groupId: string; userId: string },
  part: UploadPart,
  taskId: string | null,
): Promise<FileItem> {
  const name = sanitizeName(part.filename);
  const ext = path.extname(name).slice(1).toLowerCase();

  // 黑名单策略：只拦高危可执行/脚本，其余格式一律放行
  if (ext && isBlockedFileExtension(ext)) {
    throw new ApiError(
      415,
      `出于安全考虑，不能上传「.${ext}」这类可执行/脚本文件`,
    );
  }

  if (taskId) {
    const task = get<{ id: string }>(
      "SELECT id FROM tasks WHERE id = ? AND group_id = ?",
      taskId,
      ctx.groupId,
    );
    if (!task) throw badRequest("关联的任务不在本组");
  }

  const tempPath = path.join(STORAGE_DIR, `.upload-${newId()}`);
  const hash = createHash("sha256");
  let size = 0;

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        callback(
          new ApiError(
            413,
            `文件超过 ${formatFileLimit(MAX_UPLOAD_BYTES)} 上限，请压缩或拆分后再上传`,
          ),
        );
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
    throw new ApiError(400, "文件上传中断，请重试");
  }

  /*
   * @fastify/multipart 的 fileSize 限制在「流式消费」时是**静默截断**
   * （只有 toBuffer 路径才会抛 RequestFileTooLargeError），
   * 所以必须自己检查 truncated，否则超限文件会被截成上限大小却提示上传成功。
   */
  if ((part.file as { truncated?: boolean }).truncated) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw new ApiError(
      413,
      `文件超过 ${formatFileLimit(MAX_UPLOAD_BYTES)} 上限，请压缩或拆分后再上传`,
    );
  }

  if (size === 0) {
    unlinkSync(tempPath);
    throw badRequest("空文件无法上传");
  }

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

  try {
    assertMagic(ext, head);
  } catch (error) {
    unlinkSync(tempPath);
    throw error;
  }

  const sha256 = hash.digest("hex");
  const targetPath = path.join(STORAGE_DIR, sha256);

  // 内容寻址：同一份内容只落一次盘
  if (existsSync(targetPath)) {
    unlinkSync(tempPath);
  } else {
    renameSync(tempPath, targetPath);
  }

  const previous = get<{ version: number | null }>(
    "SELECT MAX(version) AS version FROM files WHERE group_id = ? AND name = ?",
    ctx.groupId,
    name,
  );
  const version = (previous?.version ?? 0) + 1;

  const id = newId();
  const createdAt = nowIso();
  const mime = sniffMagic(head) ?? MIME_BY_EXT[ext] ?? part.mimetype ?? "application/octet-stream";

  run(
    `INSERT INTO files
       (id, group_id, uploader_id, name, mime, size, storage_key, sha256,
        version, task_id, download_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    id,
    ctx.groupId,
    ctx.userId,
    name,
    mime,
    size,
    sha256,
    sha256,
    version,
    taskId,
    createdAt,
  );

  recordContribution(ctx.groupId, ctx.userId, "file_uploaded", "file", id, { name, size });

  const row = get<FileRow>(`${SELECT_FILES} WHERE f.id = ?`, id)!;
  const file = toItem(row);
  publish(ctx.groupId, { type: "file.created", file });
  return file;
}

export function storagePathFor(storageKey: string): string {
  const safe = path.basename(storageKey);
  const full = path.join(STORAGE_DIR, safe);
  if (!full.startsWith(STORAGE_DIR)) throw forbidden("非法路径");
  return full;
}

/** 校验成员身份并返回文件记录（下载/删除共用） */
export function getFileAsMember(groupId: string, fileId: string, userId: string): FileItem {
  requireMember(groupId, userId);
  const row = get<FileRow>(
    `${SELECT_FILES} WHERE f.id = ? AND f.group_id = ?`,
    fileId,
    groupId,
  );
  if (!row) throw notFound("文件不存在");
  return toItem(row);
}

export function getFileRow(fileId: string): { item: FileItem; storageKey: string } | null {
  const row = get<FileRow & { storage_key: string }>(
    `${SELECT_FILES} WHERE f.id = ?`,
    fileId,
  );
  if (!row) return null;
  return { item: toItem(row), storageKey: row.storage_key };
}

export function countDownload(fileId: string): void {
  run("UPDATE files SET download_count = download_count + 1 WHERE id = ?", fileId);
}

export function deleteFile(
  groupId: string,
  fileId: string,
  userId: string,
  role: "LEADER" | "MEMBER",
): void {
  const file = getFileAsMember(groupId, fileId, userId);
  if (file.uploaderId !== userId && role !== "LEADER") {
    throw forbidden("只有上传者或组长可以删除");
  }

  const storageKey = get<{ storage_key: string }>(
    "SELECT storage_key FROM files WHERE id = ?",
    fileId,
  )?.storage_key;

  run("DELETE FROM files WHERE id = ?", fileId);
  run("DELETE FROM contribution_events WHERE ref_type = 'file' AND ref_id = ?", fileId);

  // 内容寻址：没有其他记录引用同一份内容时才删磁盘
  if (storageKey) {
    const stillUsed = get<{ id: string }>(
      "SELECT id FROM files WHERE storage_key = ? LIMIT 1",
      storageKey,
    );
    if (!stillUsed) {
      const absolute = storagePathFor(storageKey);
      try {
        if (existsSync(absolute) && statSync(absolute).isFile()) unlinkSync(absolute);
      } catch {
        /* 磁盘删除失败不影响元数据已清理 */
      }
    }
  }

  publish(groupId, { type: "file.deleted", fileId });
}
