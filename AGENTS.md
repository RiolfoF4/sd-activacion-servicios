# AGENTS.md

## What this repo is
- **Current code is Phase 1 only** of the POC spec in `docs/TP8_POC_Activacion_de_Servicios_con_Kafka.md`: `activation-api`, `billing-service`, `provisioning-service`, shared `libs/contracts`, and Docker Compose infra.
- **Phase 2 is planned, not started**, in `docs/plan-fase-2.md` (notification + Mailhog → compensation → WebSocket → React UI → packaging). Before starting an increment, read its section; implement increments in order, one per session, and update the plan's Status/Handoff and this file after each verified increment.
- Later phases (crm-analytics, `libs/kafka-toolkit`, retries/DLQ, outbox) exist only in the spec. Do not create stand-ins unless asked; treat code/config as truth for what exists and `plan-fase-2.md` as the approved next scope.
- `apps/activation-api/README.md` is stock Nest boilerplate. There is no root README.

## Working agreement (owner is learning the stack)
- **Explain first, code second.** Before changing code, explain the concept and the plan in plain language. Then implement in small steps, pointing to the file and the flow involved.
- **Keep steps small and verify each one.** Use `pnpm smoke` for end-to-end behavior, or a concrete request/command for the changed piece. State what passed and what remains unverified.
- **No broad refactors or out-of-scope edits without asking.** If another file must change, explain why and get approval first.
- **For design decisions, present 2–3 options with trade-offs and a recommendation**, then let the owner choose before implementing.
- **The owner makes commits.** Never stage, commit, or push. At most propose the files to add and a commit message for the owner to review and run.
- Explain in Spanish (English technical terms are fine). The goal is that the owner learns Kafka, NestJS, Mongo, and Docker from the work.

## Commands (from repo root)
Node 24.21 + pnpm 12.11.2 are pinned. The only root script is `smoke`; everything else runs per package via `--filter`.

```bash
pnpm install
pnpm --filter @poc/contracts build   # required before building/starting apps: @poc/contracts resolves to dist/ (no TS paths)
pnpm --filter @poc/activation-api build
pnpm --filter @poc/activation-api lint        # oxlint --type-aware
pnpm --filter @poc/activation-api format      # prettier
pnpm --filter @poc/contracts check            # tsc --noEmit
```

- Full stack: `docker compose up -d --build`; `docker compose ps` should show kafka/mongo `healthy`, kafka-init/mongo-init `exited (0)`, and the three apps `running`.
- `pnpm smoke` is the de facto acceptance test and requires the stack up. It checks `202` + `PENDING` -> `ACTIVE`, both steps `OK`, and history ending in `ActivationCompleted`. It currently covers only the Phase 1 happy path; failure, compensation, and notification checks are planned for Phase 2 increment 5. Env overrides: `API_URL`, `SMOKE_TIMEOUT_MS`.
- **No unit or e2e specs exist** despite the Jest scripts; `pnpm --filter @poc/activation-api test` exits 1 with "No tests found". Verify with `pnpm smoke` or a manual POST/GET. No CI or pre-commit config.
- Local dev: copy each app's `.env.example` to `.env` (gitignored), start only infra with `docker compose up -d kafka kafka-init mongo mongo-init kafka-ui`, then `pnpm --filter @poc/activation-api start:dev` (same for billing/provisioning).
- `docker compose down` wipes all Kafka/Mongo state (no named volumes) — use it to reset a stale demo.

## Architecture
- `activation-api` is the only HTTP entrypoint (`:3000`) and the saga aggregator. Billing and provisioning are Kafka-only consumers with no HTTP server.
- `libs/contracts` is the shared contract source: topics, event types, envelope, payloads. `createEnvelope` fills `eventId`/`occurredAt`/`version`; `correlationId` = activation id; messages are keyed by `customerId` for per-customer ordering.
- Flow: `POST /activations` saves the activation and publishes `ActivationRequested` to `activation.requested`; billing and provisioning react in parallel (`billing.events`, `provisioning.events`); the aggregator records steps/status and emits `ActivationCompleted`/`ActivationFailed` to `activation.events`.
- One Mongo database per service (`activation_api`, `billing`, `provisioning`) on a single-node replica set `rs0` with `directConnection=true`. The replica set is for future transactions, not HA; never read another service's DB.
- Current reliability scope: idempotency is only `updateOne(... upsert)` on `activationId` in billing/provisioning; aggregator transitions are status-guarded. Retries, DLQ, outbox, `processed_events`, and billing compensation are not implemented. `BillingAccountCancelled` exists only as an event-type string.
- Required env per app: `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`, `MONGO_URI` (`PORT` for the API). Host `.env` uses `localhost:9092`/`localhost:27017`; Compose injects `kafka:19092` (INTERNAL listener) and `mongo:27017`. `9092` is the host-only EXTERNAL listener.

## Gotchas
- Kafka auto-topic creation is disabled. Topic names are duplicated: update both `libs/contracts/src/topics.ts` and `docker/create-topics.sh` (which also creates the `<topic>.dlq` sibling). Unknown topics fail loudly by design.
- Consumers deliberately set `subscribe: { fromBeginning: true }` (new consumer groups replay the topic) and `postfixId: ''` (avoid Nest's `-server` suffix). Don't remove casually.
- Nest 12: extra `@EventPattern` params must be declared `unknown` and cast to `KafkaContext`; typing them as `KafkaContext` breaks compilation.
- Compose app services intentionally have no `container_name`, so `docker compose up -d --scale billing-service=2` works for the scaling demo.
- One Dockerfile builds every app via `--build-arg APP=<dir>`; it builds contracts first and uses `pnpm deploy --prod`. Never copy host `node_modules` into the image (Windows binaries).
- Keep `docker/*.sh` LF (`.gitattributes` enforces it); CRLF makes bash fail with `^M: command not found`.
- Cold-start Kafka may log `not the correct coordinator`; consumers retry and the smoke timeout covers it.
- Don't run a local `start:dev` instance alongside its Compose instance: they share `KAFKA_GROUP_ID` and Kafka splits partitions.
- Code comments and docs are Spanish; keep new comments Spanish. When suggesting a commit, use Conventional Commits with app/lib scopes (`feat(activation-api): ...`).

## Debugging
- Logs: `docker compose logs -f activation-api billing-service provisioning-service`. Kafka UI: <http://localhost:8080>.
- Mongo: `docker compose exec mongo mongosh --quiet --eval "db.getSiblingDB('activation_api').activations.find().pretty()"` (same for `billing.billing_accounts`, `provisioning.provisioning_orders`).
