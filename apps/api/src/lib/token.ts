import { createHmac, timingSafeEqual } from "node:crypto";

export interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

const encode = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64url");

/** 手写 HS256 JWT：省一个依赖，逻辑足够简单可审计 */
export function signToken(
  userId: string,
  secret: string,
  ttlSeconds: number,
): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encode(
    JSON.stringify({ sub: userId, iat: issuedAt, exp: issuedAt + ttlSeconds }),
  );
  const data = `${header}.${body}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as TokenPayload;
    if (!payload?.sub || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
