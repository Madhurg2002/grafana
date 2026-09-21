# Remaining Work (Todo Ledger)

> **The only file that tracks unfinished work and when it should land.**
> Completed capabilities live in `docs/capabilities.md`; history of what
> shipped lives in git history. Update this file in the same commit that
> adds, ships, or re-times an item.

Priority legend: 🔴 now (next release) · 🟠 soon (2–3 releases) · 🟢 later (post-prod) · ⚪ maybe (needs a decision)

## 🔴 Now — before the next real user cohort

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Production env check for helmet CSP `connectSrc` | The CSP `connectSrc` allow-list is built from `CORS_ORIGIN` at boot. When a new frontend origin is added (e.g. a preview domain), verify the deployed `CORS_ORIGIN` includes it or API calls get blocked in the browser. | Next time an origin is added or the deploy config changes |

## 🟠 Soon — hardening while the app is in real use

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Alert webhook deliverability check | The evaluator posts to a user-supplied URL with retries; validate a real receiver (Slack/Discord webhook or similar) end-to-end. | First time someone configures a real webhook |
| Persistent firing-alert state for the header badge | The badge is event-driven (SSE transitions); it misses state for alerts that were already firing before the tab opened and never clears when a firing alert is deleted. A `GET /api/alerts/:tenantId/firing` seed (or badge hydration from the alerts list) closes the gap. | Next UI pass on alerting |

## 🟢 Later — explicitly deferred until prod-ready

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Email verification on signup | New accounts are trusted immediately today. Needs a `users.email_verified` column + a signed verification-token flow, all of which requires **sending mail first**. | With the Brevo setup below — same email plumbing lands together |
| Password reset via email | Currently the only recovery is Profile → Change password (requires knowing the current password). A forgotten password is unrecoverable without email. Needs a reset-token table (migration), `POST /api/auth/request-reset` + `POST /api/auth/reset` endpoints, and a `/reset` page. | With the Brevo setup below — same email plumbing lands together |
| Invite emails (Brevo) | Plumbing exists (`services/email.ts` via Brevo API, `/api/share/:id/invite`) and stays off while `BREVO_API_KEY`/`BREVO_FROM_EMAIL` are unset. Non-prod apps must not send mail. Verification + reset build on this. | When the app is declared prod-ready + Brevo sender is verified |
| Production analytics / error tracking | No Sentry/analytics wired. | At public launch |
| Live-upstream suite in CI | The gated suite (`TEST_PROMETHEUS_URL`) exists; wire it into a scheduled CI job with the demo upstream + a Postgres service. | When CI minutes are available |

## ⚪ Maybe — needs a product decision

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Log/trace correlation, non-Prometheus datasources | Out of scope by design (Prometheus-only per spec) unless the product pivots. | Only on explicit product request |
