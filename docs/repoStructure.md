grafana-passthrough/
├── .cursorrules                        # Context & rules for AI IDE extensions
├── AGENTS.md                           # Strict guidelines & coding standards for AI agents
├── README.md                           # Developer setup & quickstart guide
├── package.json                        # Root npm workspace configuration
├── render.yaml                         # Production deployment specification
│
├── docs/                               # Architectural Decision Records (ADRs) & Research
│   ├── research.md                     # Deep-dive on design choices, bottlenecks, & trade-offs
│   ├── adr-001-caching-strategy.md     # Rationale for 5-min TTL & SSE bypass
│   └── adr-002-grafana-protection.md  # Rationale for circuit breaker & connection pool
│
├── backend/                            # Fastify Proxy Server
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                    # Fastify server entry point
│       ├── config/
│       │   └── env.ts                  # Environment schema validation (Zod/TypeBox)
│       ├── db/
│       │   ├── schema.ts               # User, Tenant, & Grafana Connection schema
│       │   └── encryption.ts           # AES-256-GCM encryption helpers
│       ├── middleware/
│       │   ├── auth.ts                 # JWT / Session authentication
│       │   └── rateLimit.ts            # Rate limiting configuration
│       ├── routes/
│       │   ├── auth.ts                 # POST /api/auth (Login / Register)
│       │   ├── connect.ts              # POST /api/connect (Validate URI + Token)
│       │   ├── dashboard.ts            # GET /api/dashboards/:uid
│       │   ├── query.ts                # POST /api/ds/query
│       │   └── stream.ts               # GET /api/stream (SSE Broadcast)
│       └── services/
│           ├── cache.ts                # Cache-aside wrapper with fallback
│           ├── circuitBreaker.ts       # Throughput protection & state machine
│           ├── grafana.ts              # Undici HTTP client & Grafana REST proxy
│           └── sse.ts                  # Multi-client fan-out manager
│
└── frontend/                           # React + Vite + Tailwind Client
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── components/
        │   ├── ConnectForm.tsx         # URI & Token onboarding form
        │   ├── DashboardView.tsx       # Grid renderer for panels
        │   ├── GaugeCard.tsx           # Single-stat gauge renderer
        │   ├── HealthBadge.tsx         # Real-time SSE status pill
        │   ├── SparkLineCard.tsx       # Minimalist time-series chart
        │   └── StatusCard.tsx          # Large KPI card
        ├── hooks/
        │   ├── useDashboard.ts         # Dashboard metadata & panel query fetcher
        │   └── useSSE.ts               # SSE stream consumer hook
        └── lib/
            └── api.ts                  # Axios/Fetch client wrapper