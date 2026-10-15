# Phase 2 — Integration Foundation (status report)

## What exists

| Area | Files | Notes |
|---|---|---|
| Config | `src/lib/business-central/config.ts`, `.env.example` | Zod-validated, server-only. Rejects `NEXT_PUBLIC_` secrets, legacy aliases, mock mode in production, non-https base URL. |
| Token | `.../auth.ts` | Server-only client-credentials flow, single-flight, 5-min refresh margin, no route returns a token. |
| Registry | `.../endpoints.ts`, `src/lib/validation/odata.ts` | Only named operations are callable. Structured queries (no raw OData), per-field type/operator/sort allowlists, server-injected warehouse scope, `top` ceilings, field projection. |
| Scheduler | `.../request-scheduler.ts` | 3 lanes (interactive/write/background), bounded queues, priority + starvation guard, per-user rate limit, distributed rate token + global lease (Redis) with per-instance caps as fallback, circuit breaker. |
| Coordination | `.../coordinator.ts` | `LocalCoordinator`, `RedisCoordinator` (Lua token bucket/lease, tag-versioned cache, locks), `ResilientCoordinator` (falls back to local per call). |
| Cache | `.../cache.ts` | Tag-versioned keys (targeted invalidation), scope in key, same-instance and cross-instance single-flight. |
| Gateway | `.../client.ts` | Reads: bounded GET-only retries with jitter and Retry-After. Writes: exactly one attempt; ambiguous results become `OUTCOME_UNKNOWN`; reconcile via `findByIdempotencyKey`. |
| Idempotency | `.../idempotency.ts` | Per-user/per-operation scoped keys, payload fingerprinting. |
| Security | `src/lib/security/*`, `src/app/api/auth/*` | BC-side salted iterative password hash for live auth; Argon2id only for mock directory, opaque session id (hash stored), HttpOnly/SameSite=Strict cookie, idle + absolute expiry, CSRF token + Origin check, login throttling, generic errors, no default admin password. |
| Worker | `src/lib/queue/worker.ts` | Lease-based claim loop, jittered polling, poison handling, unknown-outcome => reconciliation, graceful drain. Tested against a fake repository. |
| Telemetry | `src/lib/telemetry/*` | Structured JSON logs with redaction; in-process p50/p95/p99, queue wait, cache/dedupe counters. |
| Health | `src/app/api/health/{live,ready}` | Liveness; readiness (config, Redis, breaker, queue depth). |
| Mock BC | `.../mock-bc.ts` | Dev/test only; refused in production by config. |

## Commands run and results

- `npm i` of pinned stack (next 16.2.6, react 19.1.1, TypeScript ~5.9, zod, ioredis 6, p-queue 9, @node-rs/argon2) — OK.
- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npx vitest run` — 7 files, 56 tests passing.
- `next build` — succeeds (6 API routes).
- Manual HTTP smoke test (dev server, mock mode): unauthenticated 401; bad login generic 401; login sets HttpOnly cookie and returns no hash; scoped item search works; filter-injection string is treated as data; `top=5000` -> 400; logout without CSRF or with foreign Origin -> 403; old cookie rejected after logout; 6th rapid login attempt -> 429.

## Known limitations (honest list)

1. **Sessions and users are mock/in-memory.** Correct for development and single-instance demos only. Live mode returns 503 `AUTH_UNAVAILABLE` until Phase 3 delivers the BC-backed session and WMS User tables. Do not deploy multi-instance before that.
2. **Redis code paths are not integration-tested.** No Redis server was available in the build sandbox. The Lua scripts and `RedisCoordinator` are unexecuted; the `LocalCoordinator` contract is tested. Needs a Redis-backed test run (Phase 6 or earlier).
3. **Nothing was run against a real Business Central.** Live OAuth, real OData behaviour, `Data-Access-Intent`, and the custom `velvotix/wms/v1.0` API contract are unverified until the AL extension exists (Phase 3).
4. **Circuit-breaker state is per instance** (not shared through Redis).
5. **Worker has no BC-backed repository yet** (needs AL bound actions: claim, process, report, heartbeat). No `worker` npm script until then.
6. **Argon2 parameters** are OWASP-class defaults, not tuned on target hardware. `@node-rs/argon2` needs a native binary for the hosting platform.
7. **No UI, MUI, PWA, or Zustand yet** (Phase 4/5). `/api/health/ready` returns config issue names (not values) when misconfigured; restrict it at the network layer if you consider names sensitive.
8. **No middleware/proxy file.** Every protected route authenticates itself; page-level guarding comes with the UI.
9. No load numbers exist; none are claimed.

## Decisions still open (from Phase 1, section 10)

Target BC version and warehouse setup; Entra ID vs app-managed users; hosting for web tier and worker; object ID range; single vs multiple service principals. Phase 3 needs the first and fourth.

## Next steps

Phase 3: confirm BC version/symbols; create the AL extension (setup, users/roles/sessions, staging header/line/tracking, transaction state machine, `velvotix/wms/v1.0` API pages, bound actions for claim/process/report/heartbeat, permission sets, AL tests); then add the BC-backed `SessionStore`, `UserDirectory` and `StagingRepository` here, and re-verify the registry against the real API.
