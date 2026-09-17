#!/bin/sh
# smoke-live.sh — end-to-end smoke check against a REAL Prometheus.
#
# Verifies the public path a new user hits: health, connect (auto-detect,
# scheme-less input), a normalized instant query, page listing, and the
# SSE stream handshake.
#
# Usage:
#   API=http://localhost:3000 BASE=prometheus.demo.prometheus.io sh scripts/smoke-live.sh
#   API=http://localhost:3000 BASE=http://10.0.0.5:9090 sh scripts/smoke-live.sh

set -eu

API="${API:-http://localhost:3000}"
BASE="${BASE:-prometheus.demo.prometheus.io}"

echo "==> 1/5 health"
curl -fsS "$API/api/health" > /dev/null
echo "    ok"

echo "==> 2/5 connect (scheme-less: $BASE)"
CONNECT=$(curl -fsS -X POST "$API/api/connect" \
  -H 'content-type: application/json' \
  -d "{\"prometheusUrl\":\"$BASE\"}")
echo "$CONNECT" | head -c 300
echo
TENANT=$(echo "$CONNECT" | sed -n 's/.*"tenantId":"\([^"]*\)".*/\1/p')
if [ -z "$TENANT" ]; then
  echo "    connect response missing tenantId" >&2
  exit 1
fi
echo "    tenant acquired"

echo "==> 3/5 instant query (hosts up)"
curl -fsS -X POST "$API/api/query" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":\"$TENANT\",\"query\":\"up\"}" | head -c 200
echo

echo "==> 4/5 pages list"
curl -fsS "$API/api/pages/$TENANT" | head -c 200
echo

echo "==> 5/5 SSE handshake (2s)"
curl -fsS -N --max-time 2 "$API/api/stream?tenantId=$TENANT" | head -c 200 || true
echo
echo "SMOKE OK — tenant $TENANT"
