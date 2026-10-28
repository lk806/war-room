import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { meQuery } from "./queries.ts";
import { useToast } from "./toast.tsx";

/**
 * AI 功能（纪要 / 拆分 / 转写）是受限功能：
 * - 未授权时按钮置灰（不是 disabled，点了要给提示，否则用户不知道为什么点不动）
 * - 点击时统一弹提示并引导到「设置」页输入授权码
 */
export function useAiGate() {
  const { data: user } = useQuery(meQuery());
  const { groupId } = useParams<{ groupId: string }>();
  const toast = useToast();
  const navigate = useNavigate();

  // 两个来源都可解锁：管理员授权（用公用 Key）或自己配了 Key（BYOK）
  const allowed = Boolean(user?.canUseAI || user?.hasByok);

  /** 返回 true 表示可以继续；false 表示已提示用户 */
  const guard = (): boolean => {
    if (allowed) return true;
    toast.push("请先输入 AI 授权码，或在设置中配置您的 API Key", "error");
    if (groupId) navigate(`/g/${groupId}/settings`);
    return false;
  };

  /** 未授权时的置灰样式 */
  const lockedClass = allowed
    ? ""
    : "opacity-50 cursor-not-allowed hover:bg-slate-50";

  return { allowed, guard, lockedClass };
}
