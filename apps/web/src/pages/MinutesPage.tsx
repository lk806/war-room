import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  FileAudio,
  Loader2,
  Mic,
  Plus,
  RotateCw,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { useParams } from "react-router-dom";
import type { ActionItem, Meeting, MeetingStatus } from "@war-room/shared";
import { MEETING_STATUS_META } from "@war-room/shared";
import { Button, Field, Input, Modal, Spinner, cx } from "../components/ui.tsx";
import { useBoardRealtime } from "../hooks/useBoardRealtime.ts";
import { api, errorMessage } from "../lib/api.ts";
import { relativeTime } from "../lib/format.ts";
import {
  aiStatusQuery,
  boardQuery,
  meetingQuery,
  meetingsQuery,
} from "../lib/queries.ts";
import { useAiGate } from "../lib/ai-access.ts";
import { useToast } from "../lib/toast.tsx";

const formatDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

function StatusBadge({ status }: { status: MeetingStatus }) {
  const meta = MEETING_STATUS_META[status];
  return (
    <span className={cx("rounded-md px-1.5 py-0.5 text-[11px] font-medium", meta.className)}>
      {meta.label}
    </span>
  );
}

export default function MinutesPage() {
  const { groupId = "" } = useParams<{ groupId: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const meetings = useQuery(meetingsQuery(groupId));
  const ai = useQuery(aiStatusQuery());
  useBoardRealtime(groupId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const list = meetings.data ?? [];

  useEffect(() => {
    if (!selectedId && list.length > 0) setSelectedId(list[0].id);
  }, [list, selectedId]);

  const createMutation = useMutation({
    mutationFn: () =>
      api<{ meeting: Meeting }>(`/api/groups/${groupId}/meetings`, {
        body: { title: title.trim() },
      }),
    onSuccess: ({ meeting }) => {
      setCreating(false);
      setTitle("");
      setSelectedId(meeting.id);
      void queryClient.invalidateQueries({ queryKey: ["meetings", groupId] });
      toast.push("会议已创建，可以开始录音了", "success");
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  return (
    <div className="flex h-full min-h-0">
      {/* 会议列表（桌面） */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold text-slate-900">会议纪要</h1>
            <p className="text-[11px] text-slate-500">{list.length} 场会议</p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            新建
          </Button>
        </div>
        <div className="thin-scrollbar flex-1 overflow-y-auto p-2">
          {meetings.isLoading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {!meetings.isLoading && list.length === 0 && (
            <p className="px-3 py-8 text-center text-[12px] leading-relaxed text-slate-400">
              还没有会议
              <br />
              点右上角新建，录一段就能自动转写
            </p>
          )}
          {list.map((meeting) => (
            <button
              key={meeting.id}
              type="button"
              onClick={() => setSelectedId(meeting.id)}
              className={cx(
                "mb-1 w-full rounded-xl px-3 py-2 text-left transition-colors",
                meeting.id === selectedId
                  ? "bg-slate-900 text-white"
                  : "hover:bg-slate-50",
              )}
            >
              <p
                className={cx(
                  "truncate text-[13px] font-medium",
                  meeting.id === selectedId ? "text-white" : "text-slate-800",
                )}
              >
                {meeting.title}
              </p>
              <p
                className={cx(
                  "mt-0.5 flex items-center gap-1.5 text-[11px]",
                  meeting.id === selectedId ? "text-slate-300" : "text-slate-400",
                )}
              >
                <span>{relativeTime(meeting.startedAt)}</span>
                <span>·</span>
                <span>{formatDuration(meeting.durationSec)}</span>
                <span className="ml-auto">
                  {MEETING_STATUS_META[meeting.status].label}
                </span>
              </p>
            </button>
          ))}
        </div>
      </aside>

      {/* 详情区 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-slate-900 lg:hidden">会议纪要</h1>
            <p className="truncate text-[12px] text-slate-500 lg:text-[13px]">
              {ai.data?.engine === "mock"
                ? "演示模式：未配置大模型 Key，内容来自内置样例"
                : ai.data
                  ? `已连接 ${ai.data.model}`
                  : "正在检查 AI 配置…"}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="lg:hidden"
            onClick={() => setMobileListOpen(true)}
          >
            会议列表
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            <span className="max-sm:hidden">新建会议</span>
          </Button>
        </header>

        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {selectedId ? (
            <MeetingDetail key={selectedId} meetingId={selectedId} groupId={groupId} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <AudioLines className="size-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">选一场会议开始</p>
              <p className="max-w-xs text-[12px] leading-relaxed text-slate-500">
                新建会议后可以现场录音或上传音频，系统会自动转写并生成纪要与行动项。
              </p>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="新建会议"
        description="先给会议起个名字，创建后直接开始录音。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              取消
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              loading={createMutation.isPending}
              disabled={title.trim().length < 2}
            >
              创建
            </Button>
          </>
        }
      >
        <div className="pb-2">
          <Field label="会议主题">
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：第三次组会 · 中期检查分工"
              maxLength={60}
            />
          </Field>
        </div>
      </Modal>

      {mobileListOpen && (
        <Modal open onClose={() => setMobileListOpen(false)} title="会议列表">
          <div className="space-y-1 pb-3">
            {list.length === 0 && (
              <p className="py-6 text-center text-[12px] text-slate-400">还没有会议</p>
            )}
            {list.map((meeting) => (
              <button
                key={meeting.id}
                type="button"
                onClick={() => {
                  setSelectedId(meeting.id);
                  setMobileListOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-slate-800">
                    {meeting.title}
                  </span>
                  <span className="block text-[11px] text-slate-400">
                    {relativeTime(meeting.startedAt)} · {formatDuration(meeting.durationSec)}
                  </span>
                </span>
                <StatusBadge status={meeting.status} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------ 详情 ------------------------------ */

function MeetingDetail({ meetingId, groupId }: { meetingId: string; groupId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const aiGate = useAiGate();
  const meeting = useQuery(meetingQuery(meetingId));
  const board = useQuery(boardQuery(groupId));

  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const data = meeting.data;

  useEffect(() => {
    if (!data) return;
    const pending = data.actionItems.filter((item) => item.status === "PENDING");
    setPicked(pending.map((item) => item.id));
  }, [data?.id, data?.actionItems.length]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["meeting", meetingId] });
    void queryClient.invalidateQueries({ queryKey: ["meetings", groupId] });
  };

  const uploadBlob = async (blob: Blob, duration: number, filename: string) => {
    // 转写走平台公用 ASR Key，所有用户都能用，不做 AI 授权限制
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", blob, filename);
      const res = await fetch(`/api/meetings/${meetingId}/audio?duration=${duration}`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `上传失败（${res.status}）`);
      }
      toast.push("音频已上传，正在转写…", "success");
      invalidate();
    } catch (error) {
      toast.push(errorMessage(error), "error");
    } finally {
      setUploading(false);
    }
  };

  const recorder = useAudioRecorder((blob, seconds) => {
    void uploadBlob(blob, seconds, `recording-${Date.now()}.webm`);
  });

  const retranscribe = useMutation({
    mutationFn: () => api(`/api/meetings/${meetingId}/transcribe`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast.push("已重新排队转写", "success");
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  const saveTranscript = useMutation({
    mutationFn: () =>
      api<{ meeting: Meeting }>(`/api/meetings/${meetingId}/transcript`, {
        method: "PATCH",
        body: { text: draft },
      }),
    onSuccess: () => {
      setEditing(false);
      invalidate();
      toast.push("逐字稿已保存", "success");
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  const generate = useMutation({
    mutationFn: () =>
      api<{ meeting: Meeting }>(`/api/meetings/${meetingId}/minutes`, { method: "POST" }),
    onSuccess: ({ meeting: updated }) => {
      invalidate();
      toast.push(`已生成纪要，提取到 ${updated.actionItems.length} 个行动项`, "success");
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  const toTasks = useMutation({
    mutationFn: () =>
      api<{ tasks: unknown[] }>(`/api/meetings/${meetingId}/tasks`, {
        body: { actionItemIds: picked },
      }),
    onSuccess: ({ tasks }) => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["board", groupId] });
      toast.push(`已创建 ${tasks.length} 个任务，去任务看板看看`, "success");
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  const removeMeeting = useMutation({
    mutationFn: () => api(`/api/meetings/${meetingId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["meetings", groupId] });
      toast.push("会议已删除", "success");
    },
    onError: (error) => toast.push(errorMessage(error), "error"),
  });

  if (meeting.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (!data) {
    return <p className="py-10 text-center text-[13px] text-slate-500">会议不存在或无权访问</p>;
  }

  const transcribing = data.status === "TRANSCRIBING";
  const members = board.data?.members ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* 标题 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{data.title}</h2>
            <StatusBadge status={data.status} />
          </div>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {relativeTime(data.startedAt)} · 时长 {formatDuration(data.durationSec)} ·{" "}
            {data.createdByName} 创建
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`删除会议「${data.title}」？`)) removeMeeting.mutate();
          }}
          className="inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-rose-600"
        >
          <Trash2 className="size-3.5" />
          删除
        </button>
      </div>

      {data.error && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{data.error}</span>
        </div>
      )}

      {/* 录音 / 音频 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <Mic className="size-4 text-slate-400" />
          <h3 className="text-[13px] font-semibold text-slate-800">录音与音频</h3>
          {data.hasAudio && (
            <span className="ml-auto text-[11px] text-slate-400">
              {data.engine === "remote" ? "真实 ASR" : "演示转写"}
            </span>
          )}
        </div>

        {!data.hasAudio ? (
          data.transcript ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-[12px] text-slate-500">
              <FileAudio className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                这场会议没有保留音频，只保存了逐字稿（常见于先有文字、后补录音的场景）。
              </span>
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="size-3.5" />
                补充音频
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadBlob(file, Math.round(file.size / 16000), file.name);
                  event.target.value = "";
                }}
              />
            </div>
          ) : (
            <div className="space-y-3">
            <div
              className={cx(
                "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-7",
                recorder.recording
                  ? "border-rose-300 bg-rose-50/60"
                  : "border-slate-200 bg-slate-50/60",
              )}
            >
              {recorder.recording ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="relative flex size-2.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75" />
                      <span className="relative inline-flex size-2.5 rounded-full bg-rose-500" />
                    </span>
                    <span className="font-mono text-base font-semibold text-slate-800">
                      {formatDuration(recorder.seconds)}
                    </span>
                  </div>
                  <p className="text-[12px] text-slate-500">正在录音，点下面按钮结束</p>
                  <Button variant="danger" onClick={recorder.stop} className="mt-1">
                    <Square className="size-3.5" />
                    停止并转写
                  </Button>
                </>
              ) : (
                <>
                  <AudioLines className="size-6 text-slate-400" />
                  <p className="text-[13px] font-medium text-slate-700">现场录音</p>
                  <p className="text-[11px] text-slate-400">
                    需要浏览器麦克风权限（HTTPS 或 localhost）
                  </p>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                    <Button
                      onClick={() => {
                        void recorder.start().catch((error: Error) =>
                          toast.push(
                            error.name === "NotAllowedError"
                              ? "麦克风权限被拒绝，请允许或改用上传音频"
                              : `无法开始录音：${error.message}`,
                            "error",
                          ),
                        );
                      }}
                      loading={uploading}
                    >
                      <Mic className="size-3.5" />
                      开始录音
                    </Button>
                    <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                      <Upload className="size-3.5" />
                      上传音频
                    </Button>
                  </div>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadBlob(file, Math.round(file.size / 16000), file.name);
                  event.target.value = "";
                }}
              />
            </div>
            {uploading && (
              <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
                <Loader2 className="size-3.5 animate-spin" />
                正在上传并触发转写…
              </p>
            )}
          </div>
          )
        ) : (
          <div className="space-y-2">
            <audio
              controls
              preload="metadata"
              src={data.audioUrl ?? undefined}
              className="w-full"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                title="重新跑一次语音转写（使用平台公用额度）"
                onClick={() => retranscribe.mutate()}
                loading={retranscribe.isPending || transcribing}
                disabled={transcribing}
              >
                <RotateCw className="size-3.5" />
                重新转写
              </Button>
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="size-3.5" />
                换一个音频
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadBlob(file, Math.round(file.size / 16000), file.name);
                  event.target.value = "";
                }}
              />
              {transcribing && (
                <span className="flex items-center gap-1.5 text-[12px] text-sky-700">
                  <Loader2 className="size-3.5 animate-spin" />
                  正在转写…
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 逐字稿 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <FileAudio className="size-4 text-slate-400" />
          <h3 className="text-[13px] font-semibold text-slate-800">逐字稿</h3>
          {data.transcript && (
            <span className="text-[11px] text-slate-400">
              {data.transcript.segments.length} 段
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {data.transcript && !editing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(data.transcript?.text ?? "");
                  setEditing(true);
                }}
              >
                编辑全文
              </Button>
            )}
          </div>
        </div>

        {transcribing && !data.transcript && (
          <div className="flex items-center gap-2 rounded-xl bg-sky-50/70 px-3 py-6 text-[12px] text-sky-800">
            <Loader2 className="size-4 animate-spin" />
            正在转写音频，稍等几秒…
          </div>
        )}

        {!data.transcript && !transcribing && (
          <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-[12px] text-slate-400">
            还没有逐字稿。录音或上传音频后会自动生成。
          </p>
        )}

        {data.transcript && editing && (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={12}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px] leading-relaxed text-slate-700 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
            />
            <p className="text-[11px] text-slate-400">
              每行按「说话人：内容」的格式保存，会后修改可以让 AI 纪要更准。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => saveTranscript.mutate()}
                loading={saveTranscript.isPending}
                disabled={!draft.trim()}
              >
                保存
              </Button>
            </div>
          </div>
        )}

        {data.transcript && !editing && (
          <ol className="space-y-2">
            {data.transcript.segments.map((segment, index) => (
              <li key={index} className="flex gap-2.5">
                <span className="mt-0.5 w-11 shrink-0 font-mono text-[11px] text-slate-400">
                  {formatDuration(segment.start)}
                </span>
                <span className="w-14 shrink-0 truncate text-[11px] font-medium text-slate-500">
                  {segment.speaker}
                </span>
                <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-slate-700">
                  {segment.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 纪要 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Wand2 className="size-4 text-brand-500" />
          <h3 className="text-[13px] font-semibold text-slate-800">AI 纪要</h3>
          {data.status === "SUMMARIZED" && (
            <span className="text-[11px] text-slate-400">
              {data.engine === "remote" ? "大模型生成，请核对" : "演示样例，请核对"}
            </span>
          )}
          <Button
            size="sm"
            variant={data.minutesMarkdown ? "secondary" : "primary"}
            className={`ml-auto ${aiGate.lockedClass}`}
            onClick={() => {
              if (!aiGate.guard()) return;
              generate.mutate();
            }}
            loading={generate.isPending}
            disabled={!data.transcript || transcribing}
            title={!data.transcript ? "先完成转写" : "根据逐字稿生成纪要与行动项"}
          >
            <Sparkles className="size-3.5" />
            {data.minutesMarkdown ? "重新生成" : "生成纪要"}
          </Button>
        </div>

        {!data.minutesMarkdown ? (
          <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-[12px] text-slate-400">
            生成后会得到「摘要 / 决议 / 行动项 / 风险」四部分，并自动提取可转任务的行动项。
          </p>
        ) : (
          <div className="space-y-4">
            <MarkdownBlocks text={data.minutesMarkdown} />
            <ActionItemList
              items={data.actionItems}
              picked={picked}
              onToggle={(id) =>
                setPicked((current) =>
                  current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                )
              }
              members={members.map((member) => member.name)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <p className="text-[11px] text-slate-400">
                勾选的行动项会成为看板任务，负责人与 DDL 自动带过去
              </p>
              <Button
                size="sm"
                onClick={() => toTasks.mutate()}
                loading={toTasks.isPending}
                disabled={picked.length === 0}
              >
                <CheckCircle2 className="size-3.5" />
                创建 {picked.length} 个任务
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ActionItemList({
  items,
  picked,
  onToggle,
  members,
}: {
  items: ActionItem[];
  picked: string[];
  onToggle: (id: string) => void;
  members: string[];
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-[12px] font-medium text-slate-600">
        行动项（{items.length}）
      </p>
      <div className="space-y-1.5">
        {items.map((item) => {
          const converted = item.status === "CONVERTED";
          const checked = picked.includes(item.id);
          return (
            <label
              key={item.id}
              className={cx(
                "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 transition-colors",
                converted
                  ? "border-emerald-200 bg-emerald-50/50"
                  : checked
                    ? "border-brand-300 bg-brand-50/40"
                    : "border-slate-200 hover:bg-slate-50",
              )}
            >
              <input
                type="checkbox"
                className="mt-1 size-3.5 accent-brand-600"
                checked={converted || checked}
                disabled={converted}
                onChange={() => onToggle(item.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-slate-800">
                  {item.title}
                  {converted && (
                    <span className="ml-1.5 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">
                      已转任务
                    </span>
                  )}
                </span>
                {item.detail && (
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                    {item.detail}
                  </span>
                )}
                <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span>
                    建议负责人：
                    {item.suggestedAssigneeName &&
                    members.includes(item.suggestedAssigneeName)
                      ? item.suggestedAssigneeName
                      : "待定"}
                  </span>
                  {item.suggestedDueAt && (
                    <span>
                      · 建议 DDL：
                      {new Date(item.suggestedDueAt).toLocaleDateString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                      })}
                    </span>
                  )}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** 极简 Markdown：标题 / 列表 / 加粗，够展示纪要即可 */
function MarkdownBlocks({ text }: { text: string }) {
  const renderInline = (line: string) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, index) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={index} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={index}>{part}</span>
      ),
    );
  };

  return (
    <div className="space-y-1 text-[13px] leading-relaxed text-slate-700">
      {text.split("\n").map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-1.5" />;
        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={index} className="pt-1 text-[12px] font-semibold text-slate-700">
              {trimmed.slice(4)}
            </h4>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={index} className="pt-2 text-[13px] font-semibold text-slate-900">
              {trimmed.slice(3)}
            </h3>
          );
        }
        if (trimmed.startsWith("# ")) {
          return (
            <h2 key={index} className="text-sm font-semibold text-slate-900">
              {trimmed.slice(2)}
            </h2>
          );
        }
        if (/^[-*]\s/.test(trimmed)) {
          return (
            <p key={index} className="flex gap-2">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-300" />
              <span>{renderInline(trimmed.slice(2))}</span>
            </p>
          );
        }
        return <p key={index}>{renderInline(trimmed)}</p>;
      })}
    </div>
  );
}

/* --------------------------- 录音 hook --------------------------- */

function useAudioRecorder(onDone: (blob: Blob, seconds: number) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const secondsRef = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持录音，请改用上传音频");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
    );
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      const elapsed = secondsRef.current;
      setRecording(false);
      setSeconds(0);
      secondsRef.current = 0;
      const blob = new Blob(chunksRef.current, { type: mime ?? "audio/webm" });
      if (blob.size > 0) doneRef.current(blob, elapsed);
    };

    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setSeconds(0);
    secondsRef.current = 0;
    timerRef.current = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state === "recording") {
        recorder.stream.getTracks().forEach((track) => track.stop());
        recorder.stop();
      }
    },
    [],
  );

  return { recording, seconds, start, stop };
}
