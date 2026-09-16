/**
 * Share-invite email via Resend (https://resend.com).
 *
 * Optional by design: when RESEND_API_KEY is not configured, sends are
 * skipped and the API reports them as skipped so the UI can fall back to
 * copy-the-link. The share link itself never depends on email delivery.
 */

interface ResendSendResponse {
  data?: { id?: string } | null;
  error?: { message?: string } | null;
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

export async function sendShareInvite(input: ShareInviteInput): Promise<ShareInviteResult> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.RESEND_FROM ?? "Passthrough <onboarding@resend.dev>";

  if (apiKey.length === 0) {
    return {
      sent: [],
      failed: [],
      skipped: input.to,
      reason: "Email not configured (set RESEND_API_KEY) — copy the link instead",
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
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: `[Passthrough] ${input.label} dashboard was shared with you`,
          html,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const body = (await response.json().catch(() => null)) as ResendSendResponse | null;
      if (response.ok && body?.error === null) {
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
