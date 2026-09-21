import { useEffect, useState } from "react";

/**
 * /privacy and /terms — public legal pages required by an app that holds
 * accounts, passwords, third-party Prometheus credentials, and share links.
 *
 * Rendered standalone (no dashboard chrome) so they are reachable when
 * signed out, including from the auth pages.
 */

export type LegalDoc = "privacy" | "terms";

const CONTENT: Record<
  LegalDoc,
  { title: string; updated: string; sections: Array<{ heading: string; body: string[] }> }
> = {
  privacy: {
    title: "Privacy Policy",
    updated: "Last updated: September 21, 2026",
    sections: [
      {
        heading: "What we collect",
        body: [
          "Account data: your email address, an optional display name, and a salted scrypt hash of your password. We never store your password in readable form.",
          "Workspace data: the Prometheus (or Grafana datasource) URLs you connect, plus any authentication tokens for those upstreams. Upstream tokens are encrypted at rest with AES-256-GCM before they touch the database.",
          "Dashboard data: the pages, widgets, and PromQL queries you create; share links you generate; and an internal activity trail recording which account made which change.",
        ],
      },
      {
        heading: "How we use it",
        body: [
          "To operate your account and dashboards: authenticate you, proxy your metric queries to the upstreams you configure, and render your workspace.",
          "To enforce access control: allow-lists, organization membership, and share-link permissions.",
          "We do not sell your data, and we do not use it for advertising.",
        ],
      },
      {
        heading: "Who can see your dashboards",
        body: [
          "Only you — until you create a share link. Share links can be public (anyone with the link), email-restricted (only allow-listed accounts), or organization-wide. Revoking a link stops access immediately.",
          "Share views are derived from signed, expiring tokens bound to the viewer's verified email.",
        ],
      },
      {
        heading: "Retention and deletion",
        body: [
          "You can delete your account at any time from Profile → Delete account. Deletion is immediate and irreversible: your workspace, dashboards, widgets, connections (including encrypted upstream tokens), alerts, and share links are removed. Org memberships are removed; organizations you created survive without you.",
          "The internal activity trail belonging to the deleted workspace is removed with it.",
        ],
      },
      {
        heading: "Security",
        body: [
          "Passwords are hashed with scrypt; sessions are HMAC-signed tokens with expiry; upstream credentials are AES-256-GCM encrypted at rest; traffic is served over HTTPS; and the API sets strict security headers (CSP, HSTS, frame-deny).",
        ],
      },
      {
        heading: "Contact",
        body: [
          "Questions or data requests: open an issue on the project repository or contact the workspace owner you collaborate with in-app.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    updated: "Last updated: September 21, 2026",
    sections: [
      {
        heading: "The service",
        body: [
          "This application is a dashboard and proxy for your own Prometheus instances. You connect your own upstream, and we render metrics and manage alerts for you. We provide the tooling; the data remains yours.",
        ],
      },
      {
        heading: "Your responsibilities",
        body: [
          "Keep your credentials safe. You are responsible for the Prometheus URLs and tokens you connect, and for who you share your dashboards with.",
          "Do not use the service to proxy systems you are not authorized to monitor, and do not attempt to access other users' workspaces.",
        ],
      },
      {
        heading: "Fair use",
        body: [
          "The API is rate-limited. Automated abuse (scraping, credential stuffing, or load generation beyond normal dashboard use) may result in throttling or account suspension.",
        ],
      },
      {
        heading: "Availability",
        body: [
          "The service is provided \"as is\", without warranties of any kind. We aim for high availability but do not guarantee uninterrupted operation. Your upstream Prometheus remains the source of truth for your monitoring.",
        ],
      },
      {
        heading: "Liability",
        body: [
          "To the maximum extent permitted by law, the authors are not liable for indirect or consequential damages, lost profits, or data loss arising from use of the service.",
        ],
      },
      {
        heading: "Changes",
        body: [
          "Material changes to these terms will be reflected on this page with an updated date. Continued use after changes take effect constitutes acceptance.",
        ],
      },
    ],
  },
};

export function LegalPage({ doc, onBack }: { doc: LegalDoc; onBack?: () => void }): JSX.Element {
  const [entered, setEntered] = useState(false);
  useEffect(() => setEntered(true), []);
  const content = CONTENT[doc];

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-200">
      <div
        className={`mx-auto max-w-2xl transition-opacity duration-500 ${entered ? "opacity-100" : "opacity-0"}`}
      >
        <button
          type="button"
          onClick={() => {
            if (onBack !== undefined) {
              onBack();
            } else {
              window.history.back();
            }
          }}
          className="mb-6 text-xs text-zinc-500 transition hover:text-zinc-300"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-semibold text-zinc-100">{content.title}</h1>
        <p className="mt-1 text-xs text-zinc-500">{content.updated}</p>
        <div className="mt-6 space-y-6">
          {content.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-sm font-semibold text-emerald-300">{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph.slice(0, 24)} className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
        <p className="mt-10 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
          Also read:{" "}
          <a
            className="text-zinc-400 underline-offset-2 hover:text-emerald-300 hover:underline"
            href={doc === "privacy" ? "/terms" : "/privacy"}
          >
            {doc === "privacy" ? "Terms of Service" : "Privacy Policy"}
          </a>
        </p>
      </div>
    </div>
  );
}
