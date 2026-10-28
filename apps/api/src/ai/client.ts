import fs from "node:fs";
import type { AiEngine, AiStatus } from "@war-room/shared";
import { AI_ACTIVATION_CODE, AI_ACTIVATION_USING_DEFAULT, AI_CONFIG } from "../config.ts";
import { withAiSlot } from "../lib/ai-gate.ts";
import { ApiError } from "../lib/http.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  tokens: number;
}

/** 任务拆解 / 纪要生成走哪个引擎 */
export function textEngine(): { engine: AiEngine; reason: string } {
  if (AI_CONFIG.forceMock) return { engine: "mock", reason: "AI_PROVIDER=mock，强制演示模式" };
  if (!AI_CONFIG.apiKey) {
    return { engine: "mock", reason: "未配置 AI_API_KEY，使用内置样例数据" };
  }
  return { engine: "remote", reason: `已连接 ${AI_CONFIG.model}` };
}

/** 语音转写走哪个引擎：单独配置 ASR_*，缺省视为未配置 */
export function asrEngine(): { engine: AiEngine; reason: string } {
  if (AI_CONFIG.forceMock) return { engine: "mock", reason: "AI_PROVIDER=mock，强制演示模式" };
  if (!AI_CONFIG.asrBaseUrl || !AI_CONFIG.asrApiKey) {
    return { engine: "mock", reason: "未配置 ASR_BASE_URL / ASR_API_KEY，使用内置样例逐字稿" };
  }
  return { engine: "remote", reason: `已连接 ${AI_CONFIG.asrModel}` };
}

export function aiStatus(): AiStatus {
  const text = textEngine();
  const asr = asrEngine();
  return {
    engine: text.engine,
    model: text.engine === "remote" ? AI_CONFIG.model : "内置样例",
    asrModel: asr.engine === "remote" ? AI_CONFIG.asrModel : "内置样例",
    reason: text.reason === asr.reason ? text.reason : `${text.reason}；${asr.reason}`,
    // 只暴露状态，不暴露授权码本身
    activation: {
      enabled: AI_ACTIVATION_CODE.length > 0,
      usingDefault: AI_ACTIVATION_USING_DEFAULT,
    },
  };
}

/** 从模型输出里抠出 JSON：兼容 ```json 代码块与前后废话 */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() ?? raw.trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new ApiError(502, "大模型没有返回 JSON，请重试");
  }
  return body.slice(start, end + 1);
}

/** 调用用的凭据：不传就用 .env 里的系统配置 */
export interface LlmEndpoint {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** 调用 OpenAI 兼容的 chat/completions，要求返回 JSON 对象 */
async function chatJSONUnlocked(
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; endpoint?: LlmEndpoint } = {},
): Promise<ChatResult> {
  const endpoint = options.endpoint ?? {
    apiKey: AI_CONFIG.apiKey,
    baseUrl: AI_CONFIG.baseUrl,
    model: AI_CONFIG.model,
  };
  const engine = textEngine();
  if (engine.engine === "mock") {
    throw new ApiError(503, "演示模式下不调用大模型");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs);

  try {
    const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1500,
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      throw new ApiError(502, `大模型接口返回 ${response.status}：${detail}`);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new ApiError(502, "大模型返回内容为空，请重试");
    }

    return { content, tokens: payload.usage?.total_tokens ?? 0 };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "大模型响应超时，请稍后重试");
    }
    throw new ApiError(502, `调用大模型失败：${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 对外的 chatJSON：限制并发后调用真实实现 */
export async function chatJSON(
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; endpoint?: LlmEndpoint } = {},
): Promise<ChatResult> {
  return withAiSlot("chat", () => chatJSONUnlocked(messages, options));
}

export interface AsrSegment {
  start: number;
  end: number;
  text: string;
}

/** 对外的 transcribeAudio：限制并发后调用真实实现 */
export async function transcribeAudio(
  absolutePath: string,
  filename: string,
  mime: string,
): Promise<{ text: string; segments: AsrSegment[] }> {
  return withAiSlot("asr", () => transcribeAudioUnlocked(absolutePath, filename, mime));
}

/** 调用 OpenAI 兼容的 /audio/transcriptions，返回带时间戳的分段 */
async function transcribeAudioUnlocked(
  absolutePath: string,
  filename: string,
  mime: string,
): Promise<{ text: string; segments: AsrSegment[] }> {
  const engine = asrEngine();
  if (engine.engine === "mock") {
    throw new ApiError(503, "演示模式下不调用语音识别");
  }

  const { size } = fs.statSync(absolutePath);
  if (size > 24 * 1024 * 1024) {
    throw new ApiError(413, "音频超过 24MB，请分段上传或改用更低的码率");
  }

  const buffer = fs.readFileSync(absolutePath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime || "audio/webm" }), filename);
  form.append("model", AI_CONFIG.asrModel);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_CONFIG.asrTimeoutMs);

  try {
    const response = await fetch(`${AI_CONFIG.asrBaseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${AI_CONFIG.asrApiKey}` },
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      throw new ApiError(502, `语音识别接口返回 ${response.status}：${detail}`);
    }

    const payload = (await response.json()) as {
      text?: string;
      segments?: { start: number; end: number; text: string }[];
    };

    const segments: AsrSegment[] = (payload.segments ?? []).map((segment) => ({
      start: Number(segment.start ?? 0),
      end: Number(segment.end ?? 0),
      text: String(segment.text ?? "").trim(),
    }));

    const text = (payload.text ?? segments.map((segment) => segment.text).join(" ")).trim();
    if (!text) throw new ApiError(502, "语音识别结果为空，请检查音频是否有效");

    return {
      text,
      segments:
        segments.length > 0
          ? segments
          : [{ start: 0, end: 0, text }],
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "语音识别超时，请缩短音频后重试");
    }
    throw new ApiError(502, `调用语音识别失败：${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
