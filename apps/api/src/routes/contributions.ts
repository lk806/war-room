import type { FastifyInstance } from "fastify";
import { contributionRangeSchema } from "@war-room/shared";
import { get } from "../db/index.ts";
import { requireUser } from "../lib/session.ts";
import { buildCsv, buildSummary } from "../services/contributions.ts";
import { requireMember } from "../services/groups.ts";

function parseRange(query: unknown) {
  const parsed = contributionRangeSchema.safeParse(query ?? {});
  return parsed.success ? parsed.data.range : "week";
}

export async function contributionRoutes(app: FastifyInstance): Promise<void> {
  /** 贡献汇总：成员维度 + 类型维度 + 近 8 周趋势 + 最近事件 */
  app.get("/api/groups/:groupId/contributions", async (request) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    requireMember(groupId, user.id);
    return buildSummary(groupId, parseRange(request.query));
  });

  /** 导出 CSV（带 BOM，Excel 直接打开不乱码） */
  app.get("/api/groups/:groupId/contributions.csv", async (request, reply) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    requireMember(groupId, user.id);

    const range = parseRange(request.query);
    const team = get<{ name: string }>("SELECT name FROM teams WHERE id = ?", groupId);
    const groupName = team?.name ?? "小组";

    const csv = buildCsv(buildSummary(groupId, range), groupName);
    const rangeLabel = range === "week" ? "近7天" : range === "month" ? "近30天" : "全部";
    const filename = `${groupName}-贡献统计-${rangeLabel}.csv`;

    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="contributions.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      )
      .header("Cache-Control", "no-store");

    return reply.send(csv);
  });
}
