prometheus-passthrough/
├── .cursorrules                        # Context & rules for AI IDE extensions
├── .github/workflows/                  # GitHub deployment checks
│   ├── render-deploy.yml               # Render deployment check
│   └── vercel-deploy.yml               # Vercel deployment check
├── .env.example                        # Environment variable template
├── .gitignore                          # Git ignore rules
├── AGENTS.md                           # Strict guidelines & coding standards for AI agents
├── Exec.md                             # Product spec & implementation plan
├── package.json                        # Root npm workspace configuration
├── scripts/                            # Operator helper scripts (npm run …)
│   ├── capability-review.sh           # Maps changed files → touched capabilities
│   └── smoke-live.sh                  # End-to-end smoke vs a real Prometheus
├── README.md                           # Developer setup & quickstart guide
├── render.yaml                         # Production deployment specification
│
├── docs/                               # Architectural Decision Records & Specifications
│   ├── research.md                     # Deep-dive on design choices, bottlenecks, & trade-offs
│   ├── repoStructure.md               # Repository file layout map
│   └── skills.md                       # Agent skills & capabilities reference
│
├── backend/                            # Fastify Proxy Server
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                    # Fastify server entry point
│   │   ├── db/
│   │   │   ├── migrations/
│   │   │   │   └── MIGRATIONS.md      # Migration system guide (add/run/status)
│   │   ├── config/
│   │   │   └── env.ts                  # Environment schema validation (Zod/TypeBox)
│   │   ├── db/
│   │   │   ├── schema.ts               # User, Tenant, & Prometheus Connection schema
│   │   │   └── encryption.ts           # AES-256-GCM encryption helpers
│   │   ├── middleware/
│   │   │   ├── auth.ts                 # JWT / Session authentication
│   │   │   └── rateLimit.ts            # Rate limiting configuration
│   │   ├── routes/
│   │   │   ├── connect.ts              # POST /api/connect (Validate URI + Token)
│   │   │   ├── query.ts                # POST /api/query & POST /api/query_range
│   │   │   └── stream.ts               # GET /api/stream (SSE Broadcast)
│   │   └── services/
│   │       ├── cache.ts                # In-memory LRU cache wrapper
│   │       ├── circuitBreaker.ts       # Circuit breaker state machine
│   │       ├── prometheus.ts           # Undici client & PromQL normalizer
│   │       └── sse.ts                  # Multi-client fan-out manager
│   └── tests/
│       ├── encryption.test.ts
│       ├── promql.test.ts
│       └── routes.test.ts
│
└── frontend/                           # React + Vite + Tailwind Client
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── components/
    │   │   ├── ConnectForm.tsx         # Prometheus URI & Token onboarding form
    │   │   ├── DashboardView.tsx       # Grid renderer for panels
    │   │   ├── GaugeCard.tsx           # Recharts semi-circle percentage gauge
    │   │   ├── HealthBadge.tsx         # Real-time SSE status pill
    │   │   ├── SparkLineCard.tsx       # Recharts metric area chart
    │   │   └── StatusCard.tsx          # Single-stat KPI card
    │   ├── hooks/
    │   │   ├── useDashboard.ts         # Query fetcher hook
    │   │   └── useSSE.ts               # SSE stream consumer hook
    │   └── lib/
    │       └── api.ts                  # Fetch API wrapper
    └── tests/
        └── components.test.tsx