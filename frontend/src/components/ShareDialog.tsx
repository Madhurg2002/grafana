import { useEffect, useRef, useState } from "react";
import { Building2, Copy, Eye, Globe, Mail, Pencil, Search, X } from "lucide-react";
import { createShareLink, listOrgs, searchUsers, type OrgSummary, type ShareLink, type ShareAccess } from "../lib/api";

type Audience = "link" | "email" | "org";
type Right = "view" | "edit";

interface Props {
  tenantId: string;
  onClose: () => void;
}

/** Audience × right → the exact access enum the backend validates. */
function toAccess(audience: Audience, right: Right): ShareAccess {
  if (audience === "link") return right === "edit" ? "anyone_edit" : "anyone_view";
  if (audience === "email") return right === "edit" ? "email_edit" : "email_view";
  return right === "edit" ? "org_edit" : "org_view";
}

const HINTS: Record<ShareAccess, string> = {
  anyone_view: "No sign-in needed. Read-only dashboard.",
  anyone_edit: "No sign-in needed. Panel changes allowed.",
  email_view: "Only allow-listed addresses can open it (view only).",
  email_edit: "Allow-listed addresses can edit panels.",
  org_view: "Every member of this workspace's org can view it.",
  org_edit: "Every member of this workspace's org can edit panels.",
};

/**
 * Share dialog: pick the audience (anyone-with-link / specific emails /
 * your org) and the right (view-only vs edit). Optionally emails the invite
 * via the backend (Resend); falls back to copy-link when email isn't set up.
 */
export function ShareDialog({ tenantId, onClose }: Props): JSX.Element {
  const [audience, setAudience] = useState<Audience>("link");
  const [right, setRight] = useState<Right>("view");
  const [emails, setEmails] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [people, setPeople] = useState<Array<{ id: string; email: string; displayName: string | null }>>([]);
  const peopleDebounce = useRef<number | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<(ShareLink & { invited?: string[]; skipped?: string[] }) | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
    };
  }, []);

  // Org audience needs the workspace attached to an org — load memberships.
  useEffect(() => {
    let cancelled = false;
    listOrgs()
      .then((payload) => {
        if (!cancelled) setOrgs(payload.orgs);
      })
      .catch(() => {
        if (!cancelled) setOrgs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const access = toAccess(audience, right);
  const hasOrg = orgs.length > 0;

  async function handleCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    setCopyStatus("idle");
    try {
      const emailList =
        audience === "email"
          ? emails
              .split(/[,\s]+/)
              .map((e) => e.trim())
              .filter((e) => e.length > 0)
          : undefined;
      const response = (await createShareLink(
        tenantId,
        undefined,
        access,
        emailList,
        audience === "email"
      )) as ShareLink & {
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

  async function handleCopyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopyStatus("copied");
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
      copyResetTimer.current = window.setTimeout(() => {
        setCopyStatus("idle");
        copyResetTimer.current = null;
      }, 2500);
    } catch {
      setCopyStatus("failed");
    }
  }

  const audienceButton = (
    key: Audience,
    label: string,
    Icon: typeof Globe,
    disabled = false,
    title = ""
  ): JSX.Element => (
    <button
      key={key}
      type="button"
      data-testid={`audience-${key}`}
      disabled={disabled}
      title={title}
      onClick={() => setAudience(key)}
      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
        audience === key
          ? "border-[#5eead4]/50 bg-[#5eead4]/10 text-[#7df0dc]"
          : "border-white/[0.09] text-[#8d95a8] hover:border-white/20 hover:text-white"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Share dashboard"
      data-testid="share-dialog"
    >
      <div className="glass-card w-full max-w-md bg-[#080a0e] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-white">Share dashboard</h2>
          <button
            type="button"
            aria-label="Close share dialog"
            onClick={onClose}
            className="rounded-md p-1 text-[#5f6779] transition hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {created === null ? (
          <>
            {/* Audience */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              {audienceButton("link", "Anyone with link", Globe)}
              {audienceButton("email", "Specific emails", Mail)}
              {audienceButton(
                "org",
                hasOrg ? "My org" : "My org (none)",
                Building2,
                !hasOrg,
                hasOrg
                  ? `Share to ${orgs.map((o) => o.name).join(", ")}`
                  : "Create or join an org in Profile → Organizations first"
              )}
            </div>

            {/* Right */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  { key: "view" as Right, label: "View only", icon: Eye },
                  { key: "edit" as Right, label: "Can edit", icon: Pencil },
                ]
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  data-testid={`right-${option.key}`}
                  onClick={() => setRight(option.key)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    right === option.key
                      ? "border-[#5eead4]/50 bg-[#5eead4]/10 text-[#7df0dc]"
                      : "border-white/[0.09] text-[#8d95a8] hover:border-white/20 hover:text-white"
                  }`}
                >
                  <option.icon className="h-3.5 w-3.5" aria-hidden />
                  {option.label}
                </button>
              ))}
            </div>

            {audience === "email" ? (
              <div className="mt-3">
                <label htmlFor="share-emails" className="field-label">
                  Email addresses <span className="normal-case tracking-normal text-[#5f6779]">(comma or space separated)</span>
                </label>
                <input
                  id="share-emails"
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  placeholder="teammate@company.com, auditor@corp.org"
                  className="field"
                />
                {/* People picker — search registered users by email or name. */}
                <div className="relative mt-2">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5f6779]"
                    aria-hidden
                  />
                  <input
                    value={peopleQuery}
                    onChange={(e) => {
                      const next = e.target.value;
                      setPeopleQuery(next);
                      if (peopleDebounce.current !== null) {
                        window.clearTimeout(peopleDebounce.current);
                      }
                      if (next.trim().length < 2) {
                        setPeople([]);
                        return;
                      }
                      peopleDebounce.current = window.setTimeout(() => {
                        searchUsers(next)
                          .then((rows) => setPeople(rows))
                          .catch(() => setPeople([]));
                      }, 250);
                    }}
                    placeholder="Search people by email or name…"
                    title="Find registered users to add to the allow-list — type at least 2 characters"
                    className="field pl-8"
                  />
                  {people.length > 0 ? (
                    <ul
                      className="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-white/[0.1] bg-[#080a0e] shadow-2xl"
                      role="listbox"
                      aria-label="Matching users"
                    >
                      {people.map((person) => (
                        <li key={person.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={false}
                            title={`Add ${person.email} to the allow-list`}
                            className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-[#c3cad8] transition hover:bg-[#5eead4]/10 hover:text-[#7df0dc]"
                            onClick={() => {
                              setEmails((current) => {
                                const existing = current
                                  .split(/[,,,]+/)
                                  .map((e) => e.trim())
                                  .filter((e) => e.length > 0);
                                if (existing.includes(person.email)) {
                                  return current;
                                }
                                return [...existing, person.email].join(", ");
                              });
                              setPeopleQuery("");
                              setPeople([]);
                            }}
                          >
                            <span className="min-w-0 truncate">{person.email}</span>
                            {person.displayName !== null ? (
                              <span className="shrink-0 text-[10px] text-[#5f6779]">{person.displayName}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[#5f6779]">
                  Recipients must sign in with an allowed address. We'll email an
                  invite if email is configured, otherwise copy the link.
                </p>
              </div>
            ) : null}

            <p className="mt-3 text-[11px] leading-relaxed text-[#5f6779]">{HINTS[access]}</p>

            {error !== null ? (
              <p
                className="mt-2 rounded-lg border border-[#fb7185]/40 bg-[#fb7185]/10 px-3 py-2 text-xs text-[#fda4af]"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                title="Generate the link with the audience and access level selected above"
                className="btn btn-primary flex-1 px-3 py-2 text-sm"
                disabled={busy || (audience === "email" && emails.trim().length === 0)}
                onClick={() => {
                  void handleCreate();
                }}
              >
                {busy ? "Creating…" : "Create share link"}
              </button>
              <button
                type="button"
                className="btn btn-ghost flex-1 px-3 py-2 text-sm"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-4 text-xs leading-relaxed text-[#8d95a8]">
              Share link ready —{" "}
              <span className="font-medium text-[#7df0dc]">
                {created.access === undefined || created.access.startsWith("anyone")
                  ? "anyone with the link"
                  : created.access.startsWith("email")
                    ? "restricted to the allow-list"
                    : "restricted to your org members"}
              </span>{" "}
              ({created.access?.endsWith("edit") === true ? "edit" : "view only"}).
            </p>
            {created.access !== undefined && created.access.startsWith("org") ? (
              <p className="mt-2 text-[11px] leading-relaxed text-[#fcd34d]/90">
                Org shares don't need a copied link — members open the dashboard
                and are recognized by their signed-in account.
              </p>
            ) : (
              <div className="mt-2 break-all rounded-lg border border-white/[0.09] bg-black/40 px-3 py-2 font-mono text-xs text-[#c3cad8]">
                {fullUrl}
              </div>
            )}
            {created.invited !== undefined && created.invited.length > 0 ? (
              <p className="mt-2 text-xs text-[#7df0dc]" role="status">
                Invitations emailed to {created.invited.length} address
                {created.invited.length === 1 ? "" : "es"}.
              </p>
            ) : null}
            {created.skipped !== undefined && created.skipped.length > 0 ? (
              <p className="mt-2 text-xs text-[#fcd34d]" role="status">
                Email isn't configured — copy the link and send it to{" "}
                {created.skipped.length} address
                {created.skipped.length === 1 ? "" : "es"} yourself.
              </p>
            ) : null}
            <div className="mt-4 flex gap-2">
              {created.access !== undefined && created.access.startsWith("org") ? null : (
                <button
                  type="button"
                  data-testid="copy-share-link"
                  title="Copy the share URL to your clipboard"
                  className="btn btn-primary flex-1 px-3 py-2 text-sm"
                  onClick={() => {
                    void handleCopyLink();
                  }}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy link"}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost flex-1 px-3 py-2 text-sm"
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
