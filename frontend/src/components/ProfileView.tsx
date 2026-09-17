import { useEffect, useState } from "react";
import { ExternalLink, Link2, Inbox, Radio, Send, X } from "lucide-react";
import { revokeShareLink, fetchProfileShares, type ProfileShare } from "../lib/api";

/**
 * /profile — one place to manage sharing:
 *  - "Created by me": every link the user made, with access level and a
 *    revoke action (revoked links stay visible, marked).
 *  - "Shared with me": email-restricted links other users allowed this
 *    account's address to open. Revoked ones are flagged.
 */
export function ProfileView({ onBack }: { onBack: () => void }): JSX.Element {
  const [created, setCreated] = useState<ProfileShare[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<ProfileShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const payload = await fetchProfileShares();
        if (!cancelled) {
          setCreated(payload.created);
          setSharedWithMe(payload.sharedWithMe);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load shares");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRevoke(share: ProfileShare): Promise<void> {
    setError(null);
    try {
      await revokeShareLink(share.id);
      setCreated((prev) =>
        prev.map((s) => (s.id === share.id ? { ...s, revoked: true } : s))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke");
    }
  }

  function copyLink(share: ProfileShare): void {
    void navigator.clipboard
      .writeText(`${window.location.origin}${share.url}`)
      .then(() => {
        setCopiedId(share.id);
        window.setTimeout(() => setCopiedId(null), 1500);
      })
      .catch(() => {
        setError("Clipboard unavailable — copy the URL from the address bar");
      });
  }

  const accessBadge = (access: ProfileShare["access"]): JSX.Element => {
    const [audience, right] = access.split("_") as ["link" | "email", "view" | "edit"];
    return (
      <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300">
        {audience === "email" ? "emails" : "anyone"} · {right}
      </span>
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <Radio className="h-4 w-4 text-emerald-300" aria-hidden />
            Passthrough
          </button>
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
          >
            Back to dashboard
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Everything you've shared, and everything shared with you — including
          anything that's been revoked.
        </p>

        {error !== null ? (
          <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="mt-8 text-sm text-zinc-500">Loading shares…</p>
        ) : (
          <>
            <section className="mt-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Send className="h-4 w-4 text-emerald-300" aria-hidden />
                Created by me
                <span className="text-xs font-normal text-zinc-500">
                  ({created.length})
                </span>
              </h2>
              {created.length === 0 ? (
                <p className="mt-2 rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
                  No share links yet — use the Share button on your dashboard.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-zinc-800/70 overflow-hidden rounded-xl border border-zinc-800/80">
                  {created.map((share) => (
                    <li
                      key={share.id}
                      className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${
                        share.revoked ? "opacity-60" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-xs text-zinc-200">
                            {share.url}
                          </span>
                          {accessBadge(share.access)}
                          {share.revoked ? (
                            <span className="flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-300">
                              <X className="h-2.5 w-2.5" aria-hidden />
                              Revoked
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[11px] text-zinc-500">
                          label “{share.label}” · created{" "}
                          {new Date(share.createdAt).toLocaleDateString()}
                          {share.access.startsWith("email") &&
                          share.allowedEmails.length > 0
                            ? ` · for ${share.allowedEmails.join(", ")}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!share.revoked ? (
                          <>
                            <button
                              type="button"
                              title="Copy the share link"
                              onClick={() => copyLink(share)}
                              className="flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
                            >
                              <Link2 className="h-3 w-3" aria-hidden />
                              {copiedId === share.id ? "Copied" : "Copy"}
                            </button>
                            <button
                              type="button"
                              title="Permanently revoke — anyone with the link loses access"
                              onClick={() => {
                                void handleRevoke(share);
                              }}
                              className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-rose-300/90 transition hover:border-rose-500/40 hover:bg-rose-500/10"
                            >
                              Revoke
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] text-zinc-600">
                            access removed
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-8">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Inbox className="h-4 w-4 text-emerald-300" aria-hidden />
                Shared with me
                <span className="text-xs font-normal text-zinc-500">
                  ({sharedWithMe.length})
                </span>
              </h2>
              {sharedWithMe.length === 0 ? (
                <p className="mt-2 rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
                  No dashboards shared with your email yet.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-zinc-800/70 overflow-hidden rounded-xl border border-zinc-800/80">
                  {sharedWithMe.map((share) => (
                    <li
                      key={share.id}
                      className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${
                        share.revoked ? "opacity-60" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-xs text-zinc-200">
                            {share.url}
                          </span>
                          {accessBadge(share.access)}
                          {share.revoked ? (
                            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-300">
                              Revoked
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[11px] text-zinc-500">
                          label “{share.label}” · shared{" "}
                          {new Date(share.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      {!share.revoked ? (
                        <a
                          href={share.url}
                          className="flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-emerald-300 transition hover:border-emerald-500/40"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden />
                          Open
                        </a>
                      ) : (
                        <span className="text-[11px] text-zinc-600">
                          access removed
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
