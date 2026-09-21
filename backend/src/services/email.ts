/**
 * Share-invite email via Brevo (https://brevo.com, formerly Sendinblue).
 *
 * Optional by design: when BREVO_API_KEY is not configured, sends are
 * skipped and the API reports them as skipped so the UI can fall back to
 * copy-the-link. The share link itself never depends on email delivery.
 *
 * Env vars:
 *   BREVO_API_KEY  — xkeysib-… transactional API key (Settings → SMTP & API)
 *   BREVO_FROM_EMAIL — verified sender address (e.g. alerts@yourdomain.com)
 *   BREVO_FROM_NAME  — display name (default "Passthrough")
 */

interface BrevoSendResponse {
  messageId?: string;
  message?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ShareInviteInput {
  to: string[];
  shareUrl: string;
  label: string;
  canEdit: boolean;
}

export interface ShareInviteResult {
  sent: string[];
  failed: string[];
  skipped: string[];
  reason?: string;
}

/** True when Brevo is configured — the app can send transactional mail. */
export function emailConfigured(): boolean {
  return (process.env.BREVO_API_KEY ?? "").length > 0;
}

export interface PasswordResetEmailInput {
  to: string;
  resetUrl: string;
}

export type PasswordResetEmailResult =
  | { status: "sent"; messageId?: string }
  | { status: "skipped"; reason: string };

/**
 * Password-reset email. Skip-safe like share invites: without Brevo config
 * the caller reports the reset link directly in the API response (dev/no-
 * mail mode) instead of pretending a mail went out.
 */
export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput
): Promise<PasswordResetEmailResult> {
  const apiKey = process.env.BREVO_API_KEY ?? "";
  const fromEmail = process.env.BREVO_FROM_EMAIL ?? "";
  const fromName = process.env.BREVO_FROM_NAME ?? "Passthrough";

  if (apiKey.length === 0 || fromEmail.length === 0) {
    return {
      status: "skipped",
      reason: "Email not configured (set BREVO_API_KEY and BREVO_FROM_EMAIL)",
    };
  }

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #18181b;">
      <h2 style="font-size: 18px; margin: 0 0 8px;">Reset your password</h2>
      <p style="font-size: 14px; color: #3f3f46; margin: 0 0 16px;">
        A password reset was requested for your Passthrough account
        (${escapeHtml(input.to)}). The link below is valid for <strong>30 minutes</strong>
        and can be used once.
      </p>
      <p style="margin: 0 0 16px;">
        <a href="${escapeHtml(input.resetUrl)}"
           style="display: inline-block; background: #10b981; color: #09090b; font-weight: 600;
                  font-size: 14px; padding: 10px 20px; border-radius: 8px; text-decoration: none;">
          Choose a new password
        </a>
      </p>
      <p style="font-size: 12px; color: #71717a; margin: 0;">
        Didn't request this? Ignore the email — your password stays unchanged.
      </p>
    </div>`;

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email: input.to }],
        subject: "[Passthrough] Reset your password",
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await response.json().catch(() => null)) as BrevoSendResponse | null;
    if (response.ok && body?.messageId !== undefined) {
      return { status: "sent", messageId: body.messageId };
    }
    return { status: "skipped", reason: "Brevo rejected the send" };
  } catch {
    return { status: "skipped", reason: "Brevo send failed" };
  }
}

export async function sendShareInvite(input: ShareInviteInput): Promise<ShareInviteResult> {
  const apiKey = process.env.BREVO_API_KEY ?? "";
  const fromEmail = process.env.BREVO_FROM_EMAIL ?? "";
  const fromName = process.env.BREVO_FROM_NAME ?? "Passthrough";

  if (apiKey.length === 0 || fromEmail.length === 0) {
    return {
      sent: [],
      failed: [],
      skipped: input.to,
      reason:
        "Email not configured (set BREVO_API_KEY and BREVO_FROM_EMAIL) — copy the link instead",
    };
  }

  const accessLine = input.canEdit
    ? "You have <strong>edit</strong> access — you can add and change dashboard panels."
    : "You have <strong>view-only</strong> access.";

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #18181b;">
      <h2 style="font-size: 18px; margin: 0 0 8px;">Dashboard shared with you</h2>
      <p style="font-size: 14px; color: #3f3f46; margin: 0 0 16px;">
        The <strong>${escapeHtml(input.label)}</strong> monitoring dashboard was shared with you on Passthrough.
        ${accessLine}
      </p>
      <p style="margin: 0 0 16px;">
        <a href="${escapeHtml(input.shareUrl)}"
           style="display: inline-block; background: #10b981; color: #09090b; font-weight: 600;
                  font-size: 14px; padding: 10px 20px; border-radius: 8px; text-decoration: none;">
          Open the dashboard
        </a>
      </p>
      <p style="font-size: 12px; color: #71717a; margin: 0;">
        Or paste this link: ${escapeHtml(input.shareUrl)}
      </p>
    </div>`;

  const sent: string[] = [];
  const failed: string[] = [];

  for (const email of input.to) {
    if (!EMAIL_RE.test(email)) {
      failed.push(email);
      continue;
    }
    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: fromEmail, name: fromName },
          to: [{ email }],
          subject: `[Passthrough] ${input.label} dashboard was shared with you`,
          htmlContent: html,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const body = (await response.json().catch(() => null)) as BrevoSendResponse | null;
      if (response.ok && body?.messageId !== undefined) {
        sent.push(email);
      } else {
        failed.push(email);
      }
    } catch {
      failed.push(email);
    }
  }

  return { sent, failed, skipped: [] };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
