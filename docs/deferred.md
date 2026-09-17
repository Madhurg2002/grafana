# Deferred Items & Known Limitations

> This file contains only unfinished work or known limitations. Remove an
> item when it ships; completed capabilities belong in `docs/capabilities.md`
> and git history.

## Product

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Log/trace correlation and non-Prometheus datasources | The product currently supports Prometheus and Grafana-backed Prometheus data only. | Only if the product scope expands beyond Prometheus metrics |

## Email

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Email verification, password reset, and invite emails | The email plumbing exists, but production email sending is intentionally disabled until a verified Brevo sender and production readiness decision exist. | When the app is declared production-ready and Brevo is configured |

## Operations

| Item | Why it matters | When / trigger |
| :--- | :--- | :--- |
| Production analytics and error tracking | No Sentry or analytics provider is currently wired. | At public launch |
| Scheduled live-upstream CI checks | The live suite is gated by `TEST_PROMETHEUS_URL` and a reachable test database. | When CI service/database resources are available |
| Real alert webhook deliverability check | Automated tests cover payloads, retries, and SSRF protection; a real Slack, Discord, or webhook receiver still needs an end-to-end check. | When someone configures a real webhook receiver |
