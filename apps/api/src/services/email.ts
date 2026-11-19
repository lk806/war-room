import nodemailer, { type Transporter } from "nodemailer";
import {
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
} from "../config.ts";

/** 是否已配置 SMTP（没配就跳过邮箱验证，保证本地开发不依赖外部服务） */
export const EMAIL_ENABLED = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transport: Transporter | null = null;

function getTransport(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transport;
}

/** 发送验证码邮件；失败时抛出可读错误（路由会把它转成 502） */
export async function sendCodeMail(params: {
  to: string;
  code: string;
  minutes: number;
  purpose: "REGISTER" | "LOGIN" | "RESET";
}): Promise<void> {
  const title =
    params.purpose === "REGISTER"
      ? "注册验证码"
      : params.purpose === "LOGIN"
        ? "登录验证码"
        : "重置密码验证码";

  await getTransport().sendMail({
    from: `"小组作业作战室" <${SMTP_FROM}>`,
    to: params.to,
    subject: `【小组作业作战室】${title}：${params.code}`,
    text: `你的${title}是 ${params.code}，${params.minutes} 分钟内有效。\n\n如果不是你本人操作，请忽略这封邮件。`,
    html: `<div style="font-family:system-ui,sans-serif;line-height:1.6">
      <p>你的<strong>${title}</strong>是：</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#4f46e5">${params.code}</p>
      <p style="color:#64748b">${params.minutes} 分钟内有效，仅可使用一次。</p>
      <p style="color:#94a3b8;font-size:12px">如果不是你本人操作，请忽略这封邮件。</p>
    </div>`,
  });
}
