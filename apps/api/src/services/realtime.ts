import type { ServerResponse } from "node:http";
import type { BoardEvent } from "@war-room/shared";

interface Subscriber {
  id: number;
  groupId: string;
  userId: string;
  res: ServerResponse;
}

const subscribers = new Set<Subscriber>();
let sequence = 0;

/** 注册一个 SSE 连接（按小组隔离） */
export function subscribe(
  groupId: string,
  userId: string,
  res: ServerResponse,
): Subscriber {
  const sub: Subscriber = { id: ++sequence, groupId, userId, res };
  subscribers.add(sub);
  return sub;
}

export function unsubscribe(sub: Subscriber): void {
  subscribers.delete(sub);
}

/** 把事件广播给同组所有在线连接 */
export function publish(groupId: string, event: BoardEvent): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const sub of subscribers) {
    if (sub.groupId !== groupId) continue;
    try {
      sub.res.write(payload);
    } catch {
      subscribers.delete(sub);
    }
  }
}

export function onlineMembers(groupId: string): string[] {
  const ids = new Set<string>();
  for (const sub of subscribers) {
    if (sub.groupId === groupId) ids.add(sub.userId);
  }
  return [...ids];
}

/**
 * 关闭所有 SSE 连接。
 * Fastify 的 app.close() 会等所有连接结束，而 SSE 是长连接——
 * 不在关闭前主动断开，进程会卡在关闭阶段被容器强杀。
 */
export function closeAllSubscribers(): number {
  const count = subscribers.size;
  for (const sub of subscribers) {
    try {
      sub.res.write(`event: shutdown\ndata: ${JSON.stringify({ type: "shutdown" })}\n\n`);
      sub.res.end();
    } catch {
      /* 连接可能已断开 */
    }
  }
  subscribers.clear();
  return count;
}

/** 25s 心跳，避免代理/浏览器把空闲连接掐掉 */
const heartbeat = setInterval(() => {
  const payload = `event: ping\ndata: ${JSON.stringify({ type: "ping", at: new Date().toISOString() })}\n\n`;
  for (const sub of subscribers) {
    try {
      sub.res.write(payload);
    } catch {
      subscribers.delete(sub);
    }
  }
}, 25_000);

heartbeat.unref();
