import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * One-time-code delivery.
 *
 * E-mail goes through any SMTP account (SMTP_HOST, SMTP_PORT, SMTP_USER,
 * SMTP_PASS, SMTP_FROM). SMS goes through Twilio's REST API (TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, TWILIO_FROM). Each channel is used when its variables are
 * set; when neither is, the caller falls back to showing the code on screen and
 * says so. A production deployment would replace Twilio with the department's
 * DLT-registered SMS gateway behind the same \`sendSms\` function.
 */

export type Channel = 'email' | 'sms';

export interface DeliveryResult {
  delivered: Channel[];
  failed: { channel: Channel; reason: string }[];
}

const env = (name: string) => process.env[name]?.trim() || undefined;

export function emailConfigured() {
  return Boolean(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS'));
}

export function smsConfigured() {
  return Boolean(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM'));
}

let transport: Transporter | null = null;
function mailer() {
  if (!transport) {
    const port = Number(env('SMTP_PORT') ?? 587);
    transport = nodemailer.createTransport({
      host: env('SMTP_HOST'),
      port,
      secure: port === 465,
      auth: { user: env('SMTP_USER')!, pass: env('SMTP_PASS')! },
    });
  }
  return transport;
}

export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  await mailer().sendMail({
    from: env('SMTP_FROM') ?? `LMPC Inspection <${env('SMTP_USER')}>`,
    to,
    subject,
    text,
    html,
  });
}

/** Indian numbers without a country code are sent as +91. */
export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

export async function sendSms(to: string, body: string) {
  const sid = env('TWILIO_ACCOUNT_SID')!;
  const token = env('TWILIO_AUTH_TOKEN')!;
  const from = env('TWILIO_FROM')!;
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: toE164(to), From: from, Body: body }).toString(),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(detail.message ?? `Twilio responded ${response.status}`);
  }
}

export async function deliverOtp(input: {
  name: string;
  email: string;
  phone: string;
  code: string;
  minutes: number;
}): Promise<DeliveryResult> {
  const result: DeliveryResult = { delivered: [], failed: [] };
  const text =
    `${input.code} is your LMPC Inspection password reset code. It is valid for ${input.minutes} minutes. ` +
    'If you did not request this, ignore this message.';

  if (emailConfigured()) {
    try {
      await sendEmail(
        input.email,
        'Your LMPC Inspection password reset code',
        `Dear ${input.name},\n\n${text}\n\n— Legal Metrology Packaged Commodities Inspection System`,
        `<p>Dear ${input.name},</p><p>Your password reset code is</p>` +
          `<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">${input.code}</p>` +
          `<p>It is valid for ${input.minutes} minutes. If you did not request this, ignore this message.</p>` +
          '<p>— Legal Metrology Packaged Commodities Inspection System</p>',
      );
      result.delivered.push('email');
    } catch (error) {
      result.failed.push({ channel: 'email', reason: error instanceof Error ? error.message : String(error) });
    }
  }

  if (smsConfigured() && input.phone) {
    try {
      await sendSms(input.phone, text);
      result.delivered.push('sms');
    } catch (error) {
      result.failed.push({ channel: 'sms', reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}
