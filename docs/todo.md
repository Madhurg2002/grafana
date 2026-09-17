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
| Apply migrations 008/009 on the production DB | Pre-deploy command (`npm run db:migrate`) is now wired in `render.yaml` (PR #9) — the tables apply automatically at the next production deploy. Verify org/pages features right after it. | At the next deploy — verify, then remove this row |
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
| Invite emails (Resend) | Plumbing exists (`services/email.ts`, `/api/share/:id/invite`) and stays off while `RESEND_API_KEY` is unset. Non-prod apps must not send mail. | When the app is declared prod-ready + domain is verified with Resend |
| Production analytics / error tracking | No Sentry/analytics wired. | At public launch |
| Live-upstream suite in CI | The gated suite (`TEST_PROMETHEUS_URL`) exists; wire it into a scheduled CI job with the demo upstream + a Postgres service. | When CI minutes are available |

## ⚪ Maybe — needs a product decision

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Log/trace correlation, non-Prometheus datasources | Out of scope by design (Prometheus-only per spec) unless the product pivots. | Only on explicit product request |
