import type { User } from "@war-room/shared";
import { AI_CONFIG } from "../config.ts";
import { forbidden } from "./http.ts";
import { getUserDeepseekKey } from "../services/auth.ts";

/**
 * 决定这次 LLM 调用用哪把 Key（BYOK）。
 *
 * 优先级：
 *   1. 用户自己配置的 DeepSeek Key（无视授权与配额）
 *   2. 用户已被授权（canUseAI）→ 用 .env 里的系统公用 Key
 *   3. 都没有 → 403，提示去设置页配 Key 或输入授权码
 *
 * 权限判断在 mock 模式之前：即使没配 Key、走演示模式，
 * 未授权的用户也不该能调用受限功能。
 */
export type LlmCredential =
  | { mode: "mock"; reason: string }
  | {
      mode: "remote";
      apiKey: string;
      baseUrl: string;
      model: string;
      /** 用的是谁的 Key：user=自带 / system=公用 */
      source: "user" | "system";
    };

const DENY_MESSAGE = "请先输入 AI 授权码，或在设置中配置您的 API Key";

export function resolveLlmCredential(user: User): LlmCredential {
  const ownKey = getUserDeepseekKey(user.id);

  // 拦截：既没配 Key 又没授权（放在最前面，演示模式下也要拦）
  if (!ownKey && !user.canUseAI) {
    throw forbidden(DENY_MESSAGE);
  }

  // 演示/测试模式：强制不发起真实请求（含自带 Key 的情况）
  if (AI_CONFIG.forceMock) {
    return { mode: "mock", reason: "AI_PROVIDER=mock，强制演示模式" };
  }

  // 优先级 1：自带 Key，直接用，不受授权/配额限制
  if (ownKey) {
    return {
      mode: "remote",
      apiKey: ownKey,
      // 自带 Key 统一按 DeepSeek 官方地址调用（用户填的就是 DeepSeek Key）
      baseUrl: AI_CONFIG.baseUrl,
      model: AI_CONFIG.model,
      source: "user",
    };
  }

  // 授权了但系统没配 Key：降级为内置样例
  if (!AI_CONFIG.apiKey) {
    return { mode: "mock", reason: "系统未配置 AI_API_KEY，使用内置样例" };
  }

  // 优先级 2：系统公用 Key
  return {
    mode: "remote",
    apiKey: AI_CONFIG.apiKey,
    baseUrl: AI_CONFIG.baseUrl,
    model: AI_CONFIG.model,
    source: "system",
  };
}
