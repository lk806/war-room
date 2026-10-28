import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CloudUpload,
  Download,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderOpen,
  Trash2,
} from "lucide-react";
import { useParams } from "react-router-dom";
import type { FileItem } from "@war-room/shared";
import {
  ALLOWED_FILE_HINT,
  MAX_FILE_BYTES,
  formatFileLimit,
  isBlockedFileExtension,
} from "@war-room/shared";
import { Avatar, Button, Spinner, cx } from "../components/ui.tsx";
import { useBoardRealtime } from "../hooks/useBoardRealtime.ts";
import { api, errorMessage } from "../lib/api.ts";
import { formatBytes, relativeTime } from "../lib/format.ts";
import { boardQuery, filesQuery } from "../lib/queries.ts";
import { useToast } from "../lib/toast.tsx";

interface UploadTask {
  id: string;
  name: string;
  progress: number;
}

const EXT_ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  md: FileText,
  txt: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  ppt: FileText,
  pptx: FileText,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
  svg: FileImage,
  zip: FileArchive,
  rar: FileArchive,
  "7z": FileArchive,
  mp3: FileAudio,
  m4a: FileAudio,
  wav: FileAudio,
  mp4: FileVideo,
  mov: FileVideo,
};

const extOf = (name: string): string => name.split(".").pop()?.toLowerCase() ?? "";

export default function FilesPage() {
  const { groupId = "" } = useParams<{ groupId: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const board = useQuery(boardQuery(groupId));
  const filesQueryResult = useQuery(filesQuery(groupId));
  useBoardRealtime(groupId);

  const [taskId, setTaskId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const tasks = board.data?.tasks ?? [];
  const files = filesQueryResult.data?.files ?? [];
  /** 服务端生效的上限（默认 200MB，可用 MAX_UPLOAD_BYTES 覆盖） */
  const maxBytes = filesQueryResult.data?.maxBytes ?? MAX_FILE_BYTES;

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => api(`/api/files/${fileId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["files", groupId] });
      toast.push("文件已删除", "success");
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  const uploadOne = (file: File) => {
    // 与后端一致：黑名单策略，只拦高危可执行/脚本（其余特殊后缀一律放行）
    const lastDot = file.name.lastIndexOf(".");
    const ext = lastDot > 0 ? file.name.slice(lastDot + 1).toLowerCase() : "";
    if (ext && isBlockedFileExtension(ext)) {
      toast.push(`${file.name}：出于安全考虑不能上传 .${ext} 这类可执行/脚本文件`, "error");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.push(`${file.name} 超过 ${formatFileLimit()} 上限，请压缩或拆分后再传`, "error");
      return;
    }
    if (file.size === 0) {
      toast.push(`${file.name} 是空文件`, "error");
      return;
    }

    const uuid = `${file.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setUploads((prev) => [...prev, { id: uuid, name: file.name, progress: 0 }]);

    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
    xhr.open("POST", `/api/groups/${groupId}/files${query}`);
    xhr.withCredentials = true;

    const finish = () => setUploads((prev) => prev.filter((item) => item.id !== uuid));

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      setUploads((prev) =>
        prev.map((item) => (item.id === uuid ? { ...item, progress: percent } : item)),
      );
    };

    xhr.onload = () => {
      finish();
      if (xhr.status >= 200 && xhr.status < 300) {
        toast.push(`${file.name} 上传完成`, "success");
        void queryClient.invalidateQueries({ queryKey: ["files", groupId] });
        return;
      }
      let message = `上传失败（${xhr.status}）`;
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        /* ignore */
      }
      toast.push(`${file.name}：${message}`, "error");
    };

    xhr.onerror = () => {
      finish();
      toast.push(`${file.name} 上传中断，请重试`, "error");
    };

    xhr.send(form);
  };

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) uploadOne(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 pt-4 pb-3 sm:px-6">
        <h1 className="text-lg font-semibold text-slate-900">文件区</h1>
        <p className="mt-0.5 text-[12px] text-slate-500">
          {files.length} 个文件 · 共 {formatBytes(totalSize)} · 单文件上限 {formatFileLimit(maxBytes)}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {/* 上传区 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="text-[12px] text-slate-500" htmlFor="attach-task">
              关联任务（可选）
            </label>
            <select
              id="attach-task"
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
              className="h-8 max-w-[18rem] rounded-lg border border-slate-200 bg-white px-2 text-[12px] text-slate-700 focus:border-brand-400 focus:outline-none"
            >
              <option value="">不关联</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={cx(
              "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
              dragging
                ? "border-brand-400 bg-brand-50/60"
                : "border-slate-200 bg-slate-50/60 hover:border-brand-300 hover:bg-brand-50/40",
            )}
          >
            <CloudUpload className="size-6 text-slate-400" />
            <p className="text-[13px] font-medium text-slate-700">
              把文件拖到这里，或点击选择
            </p>
            <p className="text-[11px] text-slate-400">
              {ALLOWED_FILE_HINT}
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => handleFiles(event.target.files)}
            />
          </div>

          {uploads.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {uploads.map((item) => (
                <div key={item.id} className="rounded-lg bg-slate-50 px-2.5 py-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-600">
                    <span className="truncate">{item.name}</span>
                    <span className="ml-2 shrink-0 text-slate-400">{item.progress}%</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 文件列表 */}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white">
          {filesQueryResult.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner />
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <FolderOpen className="size-6 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">还没有文件</p>
              <p className="text-[12px] text-slate-500">上传分工表、文档或代码压缩包，组员都能下载</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  onDelete={() => {
                    if (window.confirm(`确定删除文件「${file.name}」？`)) {
                      deleteMutation.mutate(file.id);
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function FileRow({ file, onDelete }: { file: FileItem; onDelete: () => void }) {
  const ext = extOf(file.name);
  const Icon = EXT_ICONS[ext] ?? FileText;

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-slate-50/60">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <Icon className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
          <span className="truncate">{file.name}</span>
          {file.version > 1 && (
            <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500">
              v{file.version}
            </span>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Avatar name={file.uploaderName} color={file.uploaderColor} size={14} />
            {file.uploaderName}
          </span>
          <span className="text-slate-300">·</span>
          <span>{formatBytes(file.size)}</span>
          <span className="text-slate-300">·</span>
          <span>{relativeTime(file.createdAt)}</span>
          {file.taskTitle && (
            <>
              <span className="text-slate-300">·</span>
              <span className="max-w-[10rem] truncate rounded bg-brand-50 px-1 text-brand-700">
                {file.taskTitle}
              </span>
            </>
          )}
        </p>
      </div>

      {file.downloadCount > 0 && (
        <span className="hidden text-[11px] text-slate-400 sm:inline">
          {file.downloadCount} 次下载
        </span>
      )}

      <a
        href={`/api/files/${file.id}/download`}
        className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        title="下载"
      >
        <Download className="size-4" />
      </a>
      <Button variant="ghost" size="sm" onClick={onDelete} title="删除" className="px-2 text-slate-400">
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}
