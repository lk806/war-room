import type { ZodType } from "zod";

/** 业务异常：由全局 errorHandler 统一转成 { error: "..." } */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const badRequest = (message: string): ApiError => new ApiError(400, message);
export const unauthorized = (message = "请先登录"): ApiError => new ApiError(401, message);
export const forbidden = (message = "没有权限"): ApiError => new ApiError(403, message);
export const notFound = (message = "资源不存在"): ApiError => new ApiError(404, message);
export const conflict = (message: string): ApiError => new ApiError(409, message);

/** 用 shared 里的 schema 校验入参，取第一条错误信息返回给用户 */
export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    throw badRequest(first?.message ?? "参数格式不正确");
  }
  return result.data;
}
