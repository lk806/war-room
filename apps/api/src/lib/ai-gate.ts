import { ApiError } from "./http.ts";

/**
 * 大模型 / 语音识别的并发闸门。
 *
 * 为什么需要：ASR 会把整段音频读进内存（单次最多 24MB→Blob 翻倍开销），
 * 文本模型单次也要保留响应体。没有上限时，几个人同时点「转写」就能把内存打爆。
 * 单实例进程内信号量即可，超限直接给用户明确提示，而不是把进程拖死。
 */
const MAX_CONCURRENT_AI = (() => {
  const raw = Number(process.env.AI_MAX_CONCURRENT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
})();

let running = 0;

export interface AiSlot {
  release: () => void;
}

/** 申请一个 AI 调用名额；满了抛 429 */
export function acquireAiSlot(kind: string): AiSlot {
  if (running >= MAX_CONCURRENT_AI) {
    throw new ApiError(
      429,
      `当前已有 ${running} 个 AI 任务在跑，请稍等几秒再试`,
    );
  }
  running += 1;
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      running = Math.max(0, running - 1);
    },
  };
}

/** 包一层：自动归还名额 */
export async function withAiSlot<T>(kind: string, task: () => Promise<T>): Promise<T> {
  const slot = acquireAiSlot(kind);
  try {
    return await task();
  } finally {
    slot.release();
  }
}

/** 当前占用数（自检用） */
export function aiConcurrency(): { running: number; limit: number } {
  return { running, limit: MAX_CONCURRENT_AI };
}
