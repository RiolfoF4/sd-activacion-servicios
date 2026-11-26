# AGENTS.md

## What this repo is
- **Current code is Phase 1 plus Phase 2 increments 1, 2 and 3** of the POC spec in `docs/TP8_POC_Activacion_de_Servicios_con_Kafka.md`: `activation-api` (REST + WebSocket), `billing-service`, `provisioning-service`, `notification-service`, shared `libs/contracts`, and Docker Compose infra (Kafka, Mongo, Mailpit).
- **Phase 2 is in progress** in `docs/plan-fase-2.md` (increments 1, 2 and 3 done; next: React UI → packaging). Before starting an increment, read its section; implement increments in order, one per session, and update the plan's Status/Handoff and this file after each verified increment.
- Later phases (crm-analytics, `libs/kafka-toolkit`, retries/DLQ, outbox) exist only in the spec. Do not create stand-ins unless asked; treat code/config as truth for what exists and `plan-fase-2.md` as the approved next scope.
- `apps/activation-api/README.md` is stock Nest boilerplate. There is no root README yet; creating it is planned for Phase 2 increment 5.

## Working agreement (owner is learning the stack)
- **Explain first, code second.** Before changing code, explain the concept and the plan in plain language. Then implement in small steps, pointing to the file and the flow involved.
- **Keep steps small and verify each one.** Use `pnpm smoke` for end-to-end behavior, `pnpm ws:probe` for the WebSocket channel, or a concrete request/command for the changed piece. State what passed and what remains unverified.
- **No broad refactors or out-of-scope edits without asking.** If another file must change, explain why and get approval first.
- **For design decisions, present 2–3 options with trade-offs and a recommendation**, then let the owner choose before implementing.
- **The owner makes commits.** Never stage, commit, or push. At most propose the files to add and a commit message for the owner to review and run.
- Explain in Spanish (English technical terms are fine). The goal is that the owner learns Kafka, NestJS, Mongo, and Docker from the work.

## Commands (from repo root)
Node 24.21 + pnpm 12.11.2 are pinned. The root scripts are `smoke` and `ws:probe`; everything else runs per package via `--filter`.

```bash
pnpm install
pnpm --filter @poc/contracts build   # required before building/starting apps: @poc/contracts resolves to dist/ (no TS paths)
pnpm --filter @poc/activation-api build
pnpm --filter @poc/activation-api lint        # oxlint --type-aware
pnpm --filter @poc/activation-api format      # prettier
pnpm --filter @poc/notification-service build
pnpm --filter @poc/notification-service lint
pnpm --filter @poc/contracts check            # tsc --noEmit
```

- Full stack: `docker compose up -d --build`; `docker compose ps` should show kafka/mongo/mailpit `healthy`, kafka-init/mongo-init `exited (0)`, and the four apps `running`.
- `pnpm smoke` is the de facto acceptance test and requires the stack up. It checks `202` + `PENDING` -> `ACTIVE`, both steps `OK`, and history ending in `ActivationCompleted`. It currently covers only the Phase 1 happy path; failure, compensation, and notification checks are planned for Phase 2 increment 5. Env overrides: `API_URL`, `SMOKE_TIMEOUT_MS`.
- `pnpm ws:probe` verifies the WebSocket channel and requires the stack up. It checks the CORS headers of the HTTP preflight and of the Socket.IO handshake, then runs two scenarios (happy path and `simulateFailure=provisioning`): snapshots must arrive in order (`PENDING` -> `IN_PROGRESS` -> terminal), the history must grow monotonically and the last snapshot must match `GET /activations/:id`. It warns (does not fail) when `BillingAccountCancelled` is missing, because billing may not have created the account. Env overrides: `API_URL`, `WS_PROBE_ORIGIN`, `WS_PROBE_TIMEOUT_MS`.
- **No unit or e2e specs exist** despite the Jest scripts; `pnpm --filter @poc/activation-api test` exits 1 with "No tests found". Verify with `pnpm smoke`, `pnpm ws:probe` or a manual POST/GET. No CI or pre-commit config.
- Local dev: copy each app's `.env.example` to `.env` (gitignored), start only infra with `docker compose up -d kafka kafka-init mongo mongo-init kafka-ui mailpit`, then `pnpm --filter @poc/activation-api start:dev` (same for billing/provisioning/notification).
- `docker compose down` wipes all Kafka/Mongo state (no named volumes) — use it to reset a stale demo.

## Architecture
- `activation-api` is the only HTTP entrypoint (`:3000`) and the saga aggregator; it also serves Socket.IO on the same port (path `/socket.io`). Billing, provisioning and notification are Kafka-only consumers with no HTTP server.
- `libs/contracts` is the shared contract source: topics, event types, envelope, payloads. `createEnvelope` fills `eventId`/`occurredAt`/`version`; `correlationId` = activation id; messages are keyed by `customerId` for per-customer ordering.
- Flow: `POST /activations` saves the activation and publishes `ActivationRequested` to `activation.requested`; billing and provisioning react in parallel (`billing.events`, `provisioning.events`); the aggregator records steps/status and emits `ActivationCompleted`/`ActivationFailed` to `activation.events`; notification consumes that topic and emails the result. Billing also consumes `activation.events`: on `ActivationFailed` it cancels a `CREATED` account and publishes `BillingAccountCancelled` to `billing.events`, or stores a `CANCELLED` tombstone so a late `ActivationRequested` does not create the account. `activation-api` records `BillingAccountCancelled` in the history. `ActivationFailedPayload` includes `planId`, `failedService` and `reason`.
- WebSocket contract: the gateway broadcasts `activation.updated` with the full activation snapshot (`activationId`, `customerId`, `planId`, `status`, `simulateFailure`, `steps`, `history`, `updatedAt`). `GET /activations/:id` returns that same shape, so REST and push share one contract (`activationId`, not the Mongo `_id`). `ActivationsService` emits after every persisted change (creation, step result, completion, failure, history-only events) through `ActivationsPublisher`; the gateway only owns Socket.IO. Mongo plus `GET` stay the source of truth.
- One Mongo database per service (`activation_api`, `billing`, `provisioning`, `notification`) on a single-node replica set `rs0` with `directConnection=true`. The replica set is for future transactions, not HA; never read another service's DB.
- Current reliability scope: idempotency is `updateOne(... upsert)` on `activationId` in billing/provisioning, a status-guarded cancellation in billing, a unique index on `{ activationId, eventType }` in notification (claim before send), and status-guarded aggregator transitions. Retries, DLQ, outbox, and `processed_events` are not implemented. Compensation is implemented: `BillingAccountCancelled` is published by billing and recorded in the activation history.
- Required env per app: `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`, `MONGO_URI` (`PORT` for the API; notification also needs `SMTP_HOST`, `SMTP_PORT`, optional `SMTP_FROM`). Host `.env` uses `localhost:9092`/`localhost:27017`; Compose injects `kafka:19092` (INTERNAL listener) and `mongo:27017`. `9092` is the host-only EXTERNAL listener.

## Gotchas
- Kafka auto-topic creation is disabled. Topic names are duplicated: update both `libs/contracts/src/topics.ts` and `docker/create-topics.sh` (which also creates the `<topic>.dlq` sibling). Unknown topics fail loudly by design.
- Consumers deliberately set `subscribe: { fromBeginning: true }` (new consumer groups replay the topic) and `postfixId: ''` (avoid Nest's `-server` suffix). Don't remove casually.
- `billing-svc` now subscribes to both `activation.requested` and `activation.events` with `fromBeginning: true`. On a stale Kafka state, restarting billing replays old `ActivationFailed` events and cancels old accounts; `docker compose down` wipes state for a clean demo.
- Nest 12: extra `@EventPattern` params must be declared `unknown` and cast to `KafkaContext`; typing them as `KafkaContext` breaks compilation.
- Two separate CORS configurations: HTTP uses `app.enableCors` and the Socket.IO handshake uses the `cors` of `@WebSocketGateway`. The gateway decorator options are evaluated at import time, before `ConfigModule` loads `.env`, so the allowed origins live in `apps/activation-api/src/config/cors.ts` as a constant (`localhost:5173`, `127.0.0.1:5173`). An env-driven origin list would require a custom `IoAdapter`.
- The push channel works with a single `activation-api` instance: each instance has its own Socket.IO server while the Kafka consumer group splits partitions. Multiple instances would need a Socket.IO adapter (Redis) or Mongo change streams.
- Snapshots emitted while no client is connected are not replayed: the UI must `GET /activations/:id` on mount and on reconnect. The socket only notifies; it is not a log.
- `GET /activations/:id` returns `activationId` (and drops the Mongo `_id`/`createdAt`); `scripts/smoke-test.mjs` logs `activation.activationId`.
- Compose app services intentionally have no `container_name`, so `docker compose up -d --scale billing-service=2` works for the scaling demo.
- One Dockerfile builds every app via `--build-arg APP=<dir>`; it builds contracts first and uses `pnpm deploy --prod`. Never copy host `node_modules` into the image (Windows binaries).
- Keep `docker/*.sh` LF (`.gitattributes` enforces it); CRLF makes bash fail with `^M: command not found`.
- The spec says Mailhog but Compose runs **Mailpit** (`axllent/mailpit:v1.34.0`): Mailhog is unmaintained. Same SMTP `1025`/UI `8025`; the smoke checks must use Mailpit's API (`/api/v1/messages`), not Mailhog's v2. The README will document the deviation in increment 5.
- Cold-start Kafka may log `not the correct coordinator`; consumers retry and the smoke timeout covers it.
- Don't run a local `start:dev` instance alongside its Compose instance: they share `KAFKA_GROUP_ID` and Kafka splits partitions.
- Code comments and docs are Spanish; keep new comments Spanish. When suggesting a commit, use Conventional Commits with app/lib scopes (`feat(activation-api): ...`).

## Debugging
- Logs: `docker compose logs -f activation-api billing-service provisioning-service notification-service`. Kafka UI: <http://localhost:8080>. Mailpit UI: <http://localhost:8025>.
- Mongo: `docker compose exec mongo mongosh --quiet --eval "db.getSiblingDB('activation_api').activations.find().pretty()"` (same for `billing.billing_accounts`, `provisioning.provisioning_orders`, `notification.notifications`).
- WebSocket: `pnpm ws:probe`; `docker compose logs activation-api` shows `ActivationsGateway` connect/disconnect and `ActivationsPublisher` emissions (`activation.updated emitido ...`).
