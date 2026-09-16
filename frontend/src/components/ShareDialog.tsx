import { useState } from "react";
import { Copy, Eye, Globe, Mail, Pencil, X } from "lucide-react";
import { createShareLink, type ShareLink } from "../lib/api";

type AccessChoice = "anyone_view" | "anyone_edit" | "email_view" | "email_edit";

interface Props {
  tenantId: string;
  onClose: () => void;
}

const ACCESS_OPTIONS: Array<{
  key: AccessChoice;
  audience: "link" | "email";
  right: "view" | "edit";
  title: string;
  hint: string;
}> = [
  {
    key: "anyone_view",
    audience: "link",
    right: "view",
    title: "Anyone with the link · view only",
    hint: "No sign-in needed. Read-only dashboard.",
  },
  {
    key: "anyone_edit",
    audience: "link",
    right: "edit",
    title: "Anyone with the link · can edit",
    hint: "No sign-in needed. Panel changes allowed.",
  },
  {
    key: "email_view",
    audience: "email",
    right: "view",
    title: "Specific emails · view only",
    hint: "Only allow-listed addresses can open it.",
  },
  {
    key: "email_edit",
    audience: "email",
    right: "edit",
    title: "Specific emails · can edit",
    hint: "Allow-listed addresses can edit panels.",
  },
];

/**
 * Share dialog: pick the audience (anyone-with-link vs specific emails) and
 * the right (view-only vs edit). Optionally emails the invite via the
 * backend (Resend); falls back to copy-link when email isn't configured.
 */
export function ShareDialog({ tenantId, onClose }: Props): JSX.Element {
  const [audience, setAudience] = useState<"link" | "email">("link");
  const [right, setRight] = useState<"view" | "edit">("view");
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<(ShareLink & { invited?: string[]; skipped?: string[] }) | null>(null);

  const access: AccessChoice = `${audience}_${right}` as AccessChoice;

  async function handleCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const emailList =
        audience === "email"
          ? emails
              .split(/[,\s]+/)
              .map((e) => e.trim())
              .filter((e) => e.length > 0)
          : undefined;
      const response = (await createShareLink(tenantId, undefined, access, emailList, audience === "email")) as ShareLink & {
        invited?: string[];
        skipped?: string[];
      };
      setCreated(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share link");
    } finally {
      setBusy(false);
    }
  }

  const fullUrl = created !== null ? `${window.location.origin}${created.url}` : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-label="Share dashboard"
      data-testid="share-dialog"
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Share dashboard</h2>
          <button
            type="button"
            aria-label="Close share dialog"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 transition hover:text-zinc-200"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {created === null ? (
          <>
            {/* Audience */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(
                [
                  { key: "link", label: "Anyone with link", icon: Globe },
                  { key: "email", label: "Specific emails", icon: Mail },
                ] as Array<{ key: "link" | "email"; label: string; icon: typeof Globe }>
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  data-testid={`audience-${option.key}`}
                  onClick={() => setAudience(option.key)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    audience === option.key
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                      : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  <option.icon className="h-3.5 w-3.5" aria-hidden />
                  {option.label}
                </button>
              ))}
            </div>

            {/* Right */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  { key: "view", label: "View only", icon: Eye },
                  { key: "edit", label: "Can edit", icon: Pencil },
                ] as Array<{ key: "view" | "edit"; label: string; icon: typeof Eye }>
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  data-testid={`right-${option.key}`}
                  onClick={() => setRight(option.key)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    right === option.key
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                      : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  <option.icon className="h-3.5 w-3.5" aria-hidden />
                  {option.label}
                </button>
              ))}
            </div>

            {audience === "email" ? (
              <div className="mt-3">
                <label htmlFor="share-emails" className="mb-1 block text-xs text-zinc-400">
                  Email addresses <span className="text-zinc-600">(comma or space separated)</span>
                </label>
                <input
                  id="share-emails"
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  placeholder="teammate@company.com, auditor@corp.org"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
                />
                <p className="mt-1 text-[11px] text-zinc-600">
                  Recipients must sign in with an allowed address. We'll email an
                  invite if email is configured, otherwise copy the link.
                </p>
              </div>
            ) : null}

            <p className="mt-3 text-[11px] text-zinc-600">
              {ACCESS_OPTIONS.find((o) => o.key === access)?.hint}
            </p>

            {error !== null ? (
              <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
                disabled={busy || (audience === "email" && emails.trim().length === 0)}
                onClick={() => {
                  void handleCreate();
                }}
              >
                {busy ? "Creating…" : "Create share link"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-400 transition hover:border-zinc-600"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-4 text-xs text-zinc-400">
              Share link ready —{" "}
              <span className="text-emerald-300">
                {created.access?.startsWith("email") === true
                  ? "restricted to the allow-list"
                  : "anyone with the link"}
              </span>{" "}
              ({created.access?.endsWith("edit") === true ? "edit" : "view only"}).
            </p>
            <div className="mt-2 break-all rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-200">
              {fullUrl}
            </div>
            {created.invited !== undefined && created.invited.length > 0 ? (
              <p className="mt-2 text-xs text-emerald-300" role="status">
                Invitations emailed to {created.invited.length} address
                {created.invited.length === 1 ? "" : "es"}.
              </p>
            ) : null}
            {created.skipped !== undefined && created.skipped.length > 0 ? (
              <p className="mt-2 text-xs text-amber-300" role="status">
                Email isn't configured — copy the link and send it to{" "}
                {created.skipped.length} address
                {created.skipped.length === 1 ? "" : "es"} yourself.
              </p>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                data-testid="copy-share-link"
                className="flex-1 rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
                onClick={() => {
                  void navigator.clipboard.writeText(fullUrl).catch(() => {
                    /* clipboard unavailable — URL is shown above */
                  });
                }}
              >
                <span className="flex items-center justify-center gap-1.5">
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  Copy link
                </span>
              </button>
              <button
                type="button"
                className="rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-400 transition hover:border-zinc-600"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
