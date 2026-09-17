# Remaining Work (Todo Ledger)

> **The only file that tracks unfinished work and when it should land.**
> Completed capabilities live in `docs/capabilities.md`; history of what
> shipped lives in git history. Update this file in the same commit that
> adds, ships, or re-times an item.

Priority legend: 🔴 now (next release) · 🟠 soon (2–3 releases) · 🟢 later (post-prod) · ⚪ maybe (needs a decision)

## 🔴 Now — before the next real user cohort

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Alerting (threshold → notifier) | The biggest Grafana-parity gap. Needs an `alerts` table (migration 010), a notifier service (webhook first; email waits for prod), and alert widgets in the UI. | Next feature cycle — start once the page-widget UX settles |
| Apply migrations 008–010 on the production DB | Pre-deploy command (`npm run db:migrate`) is wired in `render.yaml` (PR #9) — 008 orgs, 009 page_widgets, and 010 per-page built-ins apply automatically at the next production deploy. Verify orgs/pages/built-ins toggle right after it. | At the next deploy — verify, then remove this row |
| Click-to-filter host drill-down | Hosts-table widget renders, but clicking a host doesn't scope gauges/sparklines to it. | With the alerting cycle (same dashboard surface) |

## 🟠 Soon — hardening while the app is in real use

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Secret rotation (`ENCRYPTION_KEY` / `JWT_SECRET`) | Single-key design; rotation invalidates stored upstream tokens. Needs `v1:` key-versioning prefixes before any real credential churn. | Before onboarding users with many stored connections |
| `render.yaml` infra validation | Spec exists; the real deploy is dashboard-configured. Validate once hosting lands on Render, then delete or keep as reference. | At first Render deploy attempt |
| Share-view parity with page widgets | Share snapshots still show the fixed built-in set, not the tenant's composed pages. | After alerting — same snapshot endpoint work |

## 🟢 Later — explicitly deferred until prod-ready

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Email verification on signup | New accounts are trusted immediately today. Needs a `users.email_verified` column + a signed verification-token flow, all of which requires **sending mail first**. | With the Resend setup below — same email plumbing lands together |
| Password reset via email | Currently the only recovery is Profile → Change password (requires knowing the current password). A forgotten password is unrecoverable without email. Needs a reset-token table (migration), `POST /api/auth/request-reset` + `POST /api/auth/reset` endpoints, and a `/reset` page. | With the Resend setup below — same email plumbing lands together |
| Invite emails (Resend) | Plumbing exists (`services/email.ts`, `/api/share/:id/invite`) and stays off while `RESEND_API_KEY` is unset. Non-prod apps must not send mail. Verification + reset build on this. | When the app is declared prod-ready + domain is verified with Resend |
| Production analytics / error tracking | No Sentry/analytics wired. | At public launch |
| Live-upstream suite in CI | The gated suite (`TEST_PROMETHEUS_URL`) exists; wire it into a scheduled CI job with the demo upstream + a Postgres service. | When CI minutes are available |

## ⚪ Maybe — needs a product decision

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Log/trace correlation, non-Prometheus datasources | Out of scope by design (Prometheus-only per spec) unless the product pivots. | Only on explicit product request |
