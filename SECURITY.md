# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security problems.

Report privately by opening a [security advisory](https://github.com/madhurg2002/prometheus-passthrough/security/advisories/new) or contacting the repository owner directly. Include:

- A description of the issue and its impact
- Steps to reproduce (PoC code or requests welcome)
- Affected endpoints/components if known

You can expect an initial response within **7 days**. Fixes for critical issues are prioritized; once shipped, an advisory is published and credit is given unless you prefer otherwise.

## In scope

- Authentication and session handling (`backend/src/routes/auth.ts`, `middleware/auth.ts`)
- Share-link access control (`backend/src/routes/share.ts`, `services/shareTokens.ts`)
- Upstream credential encryption (`backend/src/db/encryption.ts`)
- PromQL normalization / query injection (`backend/src/services/prometheus.ts`)
- Cross-tenant isolation on every `/api/*` route
- Rate limiting and security headers

## Out of scope

- Volumetric DoS (the API is rate-limited; use responsible disclosure for bypasses)
- Self-XSS in user-controlled dashboard fields
- Anything requiring a compromised upstream Prometheus instance

## Design notes for reviewers

- Sessions are HMAC-signed tokens with expiry; no cookies, so no CSRF surface on the JSON API.
- Upstream tokens are AES-256-GCM encrypted before persistence; keys come from `ENCRYPTION_KEY` (fail-fast at boot).
- Share views derive identity from signed view tokens, never from client-supplied query params.
- Auth endpoints use a stricter per-IP rate-limit bucket (see `middleware/rateLimit.ts`).
