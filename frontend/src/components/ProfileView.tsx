import { useEffect, useState } from "react";
import {
  Building2,
  ExternalLink,
  KeyRound,
  Link2,
  Inbox,
  Radio,
  Send,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import {
  attachTenantToOrg,
  changePassword,
  createOrg,
  detachTenantFromOrg,
  fetchProfileShares,
  joinOrg,
  listOrgMembers,
  listOrgs,
  revokeShareLink,
  rotateInviteCode,
  updateProfile,
  type OrgMember,
  type OrgSummary,
  type ProfileShare,
} from "../lib/api";
import { useAuth } from "../hooks/useAuth";

/**
 * /profile — one place to manage sharing:
 *  - "Created by me": every link the user made, with access level and a
 *    revoke action (revoked links stay visible, marked).
 *  - "Shared with me": email-restricted links other users allowed this
 *    account's address to open. Revoked ones are flagged.
 */
export function ProfileView({ onBack }: { onBack: () => void }): JSX.Element {
  const { user, applyAuth, token } = useAuth();
  const [created, setCreated] = useState<ProfileShare[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<ProfileShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Account settings state.
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Org state.
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [membersCache, setMembersCache] = useState<Record<string, OrgMember[]>>({});
  const [newOrgName, setNewOrgName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgMessage, setOrgMessage] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);

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

  function expandOrg(org: OrgSummary): void {
    if (membersCache[org.id] !== undefined) {
      setMembersCache((prev) => {
        const next = { ...prev };
        delete next[org.id];
        return next;
      });
      return;
    }
    void listOrgMembers(org.id)
      .then((payload) => {
        setMembersCache((prev) => ({ ...prev, [org.id]: payload.members }));
      })
      .catch(() => {
        // Non-fatal — the roster simply stays empty.
      });
  }

  async function handleCreateOrg(): Promise<void> {
    if (newOrgName.trim().length < 2) return;
    setOrgBusy(true);
    setOrgError(null);
    setOrgMessage(null);
    try {
      const org = await createOrg(newOrgName.trim());
      setOrgs((prev) => [...prev, org]);
      setNewOrgName("");
      setOrgMessage(`Organization “${org.name}” created — share the invite code with teammates.`);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to create org");
    } finally {
      setOrgBusy(false);
    }
  }

  async function handleJoinOrg(): Promise<void> {
    if (inviteCode.trim().length === 0) return;
    setOrgBusy(true);
    setOrgError(null);
    setOrgMessage(null);
    try {
      const org = await joinOrg(inviteCode.trim());
      setInviteCode("");
      setOrgs((prev) =>
        prev.some((o) => o.id === org.id)
          ? prev
          : [...prev, { id: org.id, name: org.name, role: "member" }]
      );
      setOrgMessage(`Joined “${org.name}”.`);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to join org");
    } finally {
      setOrgBusy(false);
    }
  }

  async function handleRotate(org: OrgSummary): Promise<void> {
    setOrgBusy(true);
    setOrgError(null);
    try {
      const { inviteCode: code } = await rotateInviteCode(org.id);
      setOrgs((prev) =>
        prev.map((o) => (o.id === org.id ? { ...o, inviteCode: code } : o))
      );
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to rotate code");
    } finally {
      setOrgBusy(false);
    }
  }

  async function handleAttach(org: OrgSummary): Promise<void> {
    if (user === null) return;
    setOrgBusy(true);
    setOrgError(null);
    setOrgMessage(null);
    try {
      await attachTenantToOrg(org.id, user.tenantId);
      setOrgMessage(`Your workspace is now attached to “${org.name}” — members can open it.`);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to attach workspace");
    } finally {
      setOrgBusy(false);
    }
  }

  async function handleDetach(): Promise<void> {
    if (user === null) return;
    setOrgBusy(true);
    setOrgError(null);
    setOrgMessage(null);
    try {
      await detachTenantFromOrg(user.tenantId);
      setOrgMessage("Workspace detached — org members no longer have access.");
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to detach workspace");
    } finally {
      setOrgBusy(false);
    }
  }

  async function handleSaveProfile(): Promise<void> {
    setAccountError(null);
    setAccountMessage(null);
    try {
      const result = await updateProfile(displayName.trim());
      if (token !== null && user !== null) {
        applyAuth(token, { ...user, displayName: result.user.displayName });
      }
      setAccountMessage("Display name updated.");
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Failed to update profile");
    }
  }

  async function handleChangePassword(): Promise<void> {
    setAccountError(null);
    setAccountMessage(null);
    if (newPassword.length < 8) {
      setAccountError("New password must be at least 8 characters");
      return;
    }
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setAccountMessage("Password changed.");
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Failed to change password");
    }
  }

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
          Account settings, your organizations, and everything shared —
          including anything that's been revoked.
        </p>

        {/* Account settings: display name + password change. */}
        <section className="mt-8" data-testid="account-settings">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden />
            Account
            <span className="text-xs font-normal text-zinc-500">{user?.email}</span>
          </h2>
          <div className="mt-2 grid grid-cols-1 gap-4 rounded-xl border border-zinc-800/80 p-4 sm:grid-cols-2">
            <div>
              <label htmlFor="displayName" className="mb-1 block text-xs text-zinc-400">
                Display name
              </label>
              <div className="flex gap-2">
                <input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={80}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/50"
                />
                <button
                  type="button"
                  className="rounded-lg border border-zinc-800 px-3 text-xs text-zinc-300 transition hover:border-emerald-500/40 hover:text-emerald-300"
                  onClick={() => {
                    void handleSaveProfile();
                  }}
                >
                  Save
                </button>
              </div>
            </div>
            <div>
              <p className="mb-1 flex items-center gap-1 text-xs text-zinc-400">
                <KeyRound className="h-3 w-3" aria-hidden />
                Change password
              </p>
              <input
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="mb-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
              />
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="New password (8+ chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
                />
                <button
                  type="button"
                  disabled={currentPassword.length === 0 || newPassword.length < 8}
                  className="whitespace-nowrap rounded-lg border border-zinc-800 px-3 text-xs text-zinc-300 transition hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-40"
                  onClick={() => {
                    void handleChangePassword();
                  }}
                >
                  Change
                </button>
              </div>
            </div>
          </div>
          {accountMessage !== null ? (
            <p className="mt-2 text-xs text-emerald-300" role="status">{accountMessage}</p>
          ) : null}
          {accountError !== null ? (
            <p className="mt-2 text-xs text-rose-300" role="alert">{accountError}</p>
          ) : null}
        </section>

        {/* Organizations: create/join, attach workspace, member roster. */}
        <section className="mt-8" data-testid="orgs-section">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Building2 className="h-4 w-4 text-emerald-300" aria-hidden />
            Organizations
            <span className="text-xs font-normal text-zinc-500">
              share your workspace with your whole team at once
            </span>
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="New org name"
              maxLength={64}
              className="w-40 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
            />
            <button
              type="button"
              disabled={orgBusy || newOrgName.trim().length < 2}
              className="flex items-center gap-1 rounded-lg bg-emerald-500/90 px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
              onClick={() => {
                void handleCreateOrg();
              }}
            >
              <Building2 className="h-3 w-3" aria-hidden />
              Create
            </button>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Invite code to join"
              className="w-44 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
            />
            <button
              type="button"
              disabled={orgBusy || inviteCode.trim().length === 0}
              className="flex items-center gap-1 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-300 transition hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-50"
              onClick={() => {
                void handleJoinOrg();
              }}
            >
              <UserPlus className="h-3 w-3" aria-hidden />
              Join
            </button>
          </div>
          {orgMessage !== null ? (
            <p className="mt-2 text-xs text-emerald-300" role="status">{orgMessage}</p>
          ) : null}
          {orgError !== null ? (
            <p className="mt-2 text-xs text-rose-300" role="alert">{orgError}</p>
          ) : null}

          {orgs.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-zinc-800 px-4 py-4 text-center text-xs text-zinc-500">
              No organizations yet — create one, or join with a code from a
              teammate. Attach your workspace to share everything you build.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {orgs.map((org) => (
                <li
                  key={org.id}
                  className="rounded-xl border border-zinc-800/80 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-zinc-200">{org.name}</p>
                      <p className="text-[11px] text-zinc-500">
                        {org.role === "owner" ? "You own this org" : "Member"}
                        {org.inviteCode !== undefined
                          ? ` · invite code ${org.inviteCode}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {org.inviteCode !== undefined ? (
                        <>
                          <button
                            type="button"
                            title="Copy the invite code"
                            className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
                            onClick={() => {
                              void navigator.clipboard.writeText(org.inviteCode ?? "").catch(() => undefined);
                            }}
                          >
                            Copy code
                          </button>
                          <button
                            type="button"
                            title="Invalidate the old code and mint a new one"
                            disabled={orgBusy}
                            className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
                            onClick={() => {
                              void handleRotate(org);
                            }}
                          >
                            Rotate
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
                        onClick={() => expandOrg(org)}
                      >
                        {membersCache[org.id] === undefined ? "Members" : "Hide"}
                      </button>
                      <button
                        type="button"
                        title="Attach your workspace — every org member can then open it"
                        disabled={orgBusy}
                        className="rounded-md border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-300 transition hover:bg-emerald-500/10"
                        onClick={() => {
                          void handleAttach(org);
                        }}
                      >
                        Attach workspace
                      </button>
                    </div>
                  </div>
                  {membersCache[org.id] !== undefined ? (
                    <ul className="mt-2 flex flex-col gap-1 border-t border-zinc-800/60 pt-2">
                      {(membersCache[org.id] ?? []).map((member) => (
                        <li
                          key={member.email}
                          className="flex items-center justify-between text-xs"
                        >
                          <span className="text-zinc-300">
                            {member.displayName ?? member.email}
                            {member.displayName !== null ? (
                              <span className="ml-1 text-zinc-600">({member.email})</span>
                            ) : null}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                            {member.role}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {user !== null && orgs.length > 0 ? (
            <button
              type="button"
              className="mt-2 text-[11px] text-zinc-500 underline-offset-2 hover:text-rose-300 hover:underline"
              onClick={() => {
                void handleDetach();
              }}
            >
              Detach my workspace from its org
            </button>
          ) : null}
        </section>

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
