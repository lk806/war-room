import { createReadStream, existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { formatFileLimit, type FileItem, type ReminderItem } from "@war-room/shared";
import { MAX_UPLOAD_BYTES } from "../config.ts";
import { ApiError, badRequest, notFound } from "../lib/http.ts";
import { requireUser } from "../lib/session.ts";
import { requireMember } from "../services/groups.ts";
import { listReminders, sweepReminders } from "../services/reminders.ts";
import {
  countDownload,
  deleteFile,
  getFileAsMember,
  getFileRow,
  listFiles,
  saveUpload,
  storagePathFor,
} from "../services/files.ts";

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/groups/:groupId/files", async (request) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    requireMember(groupId, user.id);
    return { files: listFiles(groupId), maxBytes: MAX_UPLOAD_BYTES };
  });

  app.post("/api/groups/:groupId/files", async (request, reply) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    requireMember(groupId, user.id);

    const query = request.query as { taskId?: string };
    const taskId = query.taskId?.trim() || null;

    // 先用 Content-Length 快速拒绝明显超限的请求（省得传完 200MB 才报错）
    const declared = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + 64 * 1024) {
      throw new ApiError(
        413,
        `文件超过 ${formatFileLimit(MAX_UPLOAD_BYTES)} 上限，请压缩或拆分后再上传`,
      );
    }

    const part = await request.file();
    if (!part) throw badRequest("没有收到文件");

    const file: FileItem = await saveUpload(
      { groupId, userId: user.id },
      part,
      taskId,
    );
    reply.code(201);
    return { file };
  });

  app.get("/api/files/:fileId/download", async (request, reply) => {
    const user = requireUser(request);
    const { fileId } = request.params as { fileId: string };

    const row = getFileRow(fileId);
    if (!row) throw notFound("文件不存在");

    // 只有组员能下载
    getFileAsMember(row.item.groupId, fileId, user.id);

    const absolute = storagePathFor(row.storageKey);
    if (!existsSync(absolute)) throw notFound("文件内容已丢失，请重新上传");

    countDownload(fileId);

    const encoded = encodeURIComponent(row.item.name);
    reply
      .header("Content-Type", row.item.mime)
      .header("Content-Length", String(row.item.size))
      // filename* 用 RFC 5987 编码，保证中文名不乱码
      .header(
        "Content-Disposition",
        `attachment; filename="download"; filename*=UTF-8''${encoded}`,
      )
      .header("X-Content-Type-Options", "nosniff");

    return reply.send(createReadStream(absolute));
  });

  app.delete("/api/files/:fileId", async (request) => {
    const user = requireUser(request);
    const { fileId } = request.params as { fileId: string };

    const row = getFileRow(fileId);
    if (!row) throw notFound("文件不存在");

    const { role } = requireMember(row.item.groupId, user.id);
    deleteFile(row.item.groupId, fileId, user.id, role);
    return { ok: true };
  });

  /** DDL 页面用：最近发出的提醒记录 */
  app.get("/api/groups/:groupId/reminders", async (request) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    requireMember(groupId, user.id);
    const reminders: ReminderItem[] = listReminders(groupId);
    return { reminders };
  });

  /** 手动触发一次扫描（演示 / 调试用，普通成员也可以点） */
  app.post("/api/groups/:groupId/reminders/sweep", async (request) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    requireMember(groupId, user.id);
    const sent = sweepReminders();
    return { sent, reminders: listReminders(groupId) };
  });
}
