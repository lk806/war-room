export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * 统一请求封装：同源 Cookie 鉴权、错误信息抽取、JSON 解析。
 * 后端约定失败返回 { error: "给用户看的中文提示" }。
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = options.body ? "POST" : "GET", body, signal } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    // 主动取消（组件卸载/切换查询）原样抛出，让 TanStack Query 自己处理
    if (error instanceof Error && error.name === "AbortError") throw error;
    // 其余是网络层失败：fetch 的原始报错是英文 "Failed to fetch"，换成能看懂的提示
    throw new ApiError(0, "网络连接失败，请检查网络后重试");
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ??
      (response.status === 401 ? "登录已过期，请重新登录" : `请求失败（${response.status}）`);
    throw new ApiError(response.status, message);
  }

  return payload as T;
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "操作失败，请稍后再试";
