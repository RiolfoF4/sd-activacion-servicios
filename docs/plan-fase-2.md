# Phase 2 Plan — Visible

**Status:** in progress — increment 3 verified (2026-11-25)
**Current phase:** 2
**Next increment:** 4 — React UI
**Baseline:** Phase 1 verified; increments 1, 2 and 3 verified.

## Scope

Phase 2 makes the activation flow visible end to end:

- RF-01: UI form to create an activation with `customerId`, `planId`, and optional `simulateFailure`.
- RF-06: compensation when billing or provisioning fails.
- RF-07: notification emails through Mailpit (Mailhog-compatible).
- RF-08: live timeline over WebSocket.
- RNF-01: the whole stack starts with `docker compose up`.

Out of scope for this phase:

- RF-10 (`crm-analytics`, replay).
- Full idempotency with `processed_events`, retries, and DLQ (RNF-03/RNF-04).
- Demo scenarios 3–5.
- Transactional outbox, Schema Registry, OpenTelemetry.

No new Kafka topics are needed. `activation.requested`, `billing.events`, `provisioning.events`, `activation.events`, and their DLQs already exist.

> **Deviation from the spec:** the POC specifies Mailhog. We use Mailpit instead because Mailhog is unmaintained. Mailpit is a drop-in for this use case (SMTP `1025`, web UI `8025`), has a maintained multi-arch image, and exposes a stable API (`/api/v1/messages`). The deviation will be documented in the root README, which is created in increment 5.

## Working agreement

- One session per increment, in the order below.
- Explain the concept first, then implement in small steps.
- The owner makes commits. At most, propose files and a commit message.
- Each increment ends with a concrete verification and an updated Handoff section.
- Keep `AGENTS.md` in sync with the repo state.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Increment order | Backend first: notification → compensation → WebSocket → UI → packaging | The UI is built once, with the final event set. |
| Notifications | Separate `notification-service` + Mailpit | Same consumer pattern as billing/provisioning; Mailpit is a maintained drop-in for the spec's Mailhog inbox. |
| Compensation | Billing consumes `activation.events` and keeps a `CANCELLED` tombstone in `billing_accounts` per `activationId` | Covers the race where `ActivationFailed` arrives before billing creates the account; the existing upsert ignores a late `ActivationRequested`. |
| Cancellation payload | `BillingAccountCancelledPayload = { billingAccountId, planId, reason }` | Self-contained event for the timeline, logs and future CRM consumers. |
| WebSocket payload | Full activation snapshot, broadcast to all clients | Simple and robust; the UI filters by `activationId` and can always fall back to `GET`. |
| REST and WebSocket contract | One `ActivationSnapshot` shape for both (`activationId`, `customerId`, `planId`, `status`, `simulateFailure`, `steps`, `history`, `updatedAt`) | The UI reads the same shape from `GET` and from `activation.updated`, with no `_id`/`activationId` duality. The REST response changes (`_id` and `createdAt` are dropped) and `scripts/smoke-test.mjs` logs `activation.activationId` instead of `activation._id`. |
| CORS origins | Fixed list shared by HTTP and Socket.IO (`http://localhost:5173`, `http://127.0.0.1:5173`) | Both the Vite dev server and the Compose UI use `5173`. Gateway decorator options are evaluated at import time, before `ConfigModule` loads `.env`, so an env-driven origin list would require a custom `IoAdapter`. Revisit if another origin is needed. |
| WebSocket verification | `scripts/ws-probe.mjs` with `socket.io-client` as a root devDependency; happy and failure scenarios | Repeatable, covers `FAILED` and compensation, and reusable in the increment 5 smoke. |
| UI to API | Direct call to `:3000` with CORS, no nginx proxy | Fewer moving parts; CORS is also needed for local Vite development. |
| Simulated inbox | Mailpit instead of Mailhog | Mailhog is unmaintained; Mailpit keeps the same ports and SMTP behavior, and its API is used by the smoke test. |
| Error email content | Add `planId` to `ActivationFailedPayload` | The failure email is as informative as the welcome one; a one-field contract addition. |
| Phase 2 idempotency | Unique indexes and `upsert` only | Full redelivery guarantees belong to Phase 3. |

## Increments

### 1. Notification + Mailpit — done

**Objective:** every finished activation produces a visible email.

**Changes:**

- Add Mailpit to `docker-compose.yml` (`axllent/mailpit:v1.34.0`): SMTP `1025`, web UI `8025`. The image ships its own healthcheck.
- Create `apps/notification-service` following the billing-service pattern:
  - Kafka consumer group `notification-svc`.
  - Mongo database `notification`.
  - Consumer for `activation.events`.
- Process only `ActivationCompleted` and `ActivationFailed`; ignore other event types.
- Store one document per `{ activationId, eventType }` in the `notifications` collection, with a unique index.
- Send the email with `nodemailer` to Mailpit:
  - Welcome email for `ActivationCompleted`.
  - Error email for `ActivationFailed`, including `planId`, `failedService`, and `reason`.
  - Simulated recipient: `<customerId>@demo.local`.
- Add the new app's `package.json` to the root `Dockerfile` install stage.
- Add the service to Compose with `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_FROM=no-reply@demo.local`, and its Mongo/Kafka env vars.

**Verification:**

- Happy path: activation ends `ACTIVE`, welcome email appears in Mailpit, notification document is `SENT`.
- Failure path: activation ends `FAILED`, error email appears in Mailpit.
- No duplicate email for the same `{ activationId, eventType }`.

**Concepts to learn:** fan-out, consumer groups, DB per service, SMTP as an external system, idempotency with a unique index.

**Known limitation:** the notification document is inserted before sending. If SMTP fails, the document stays `FAILED` and is not retried until Phase 3.

### 2. Compensation — done

**Objective:** a failure never leaves an orphan billing account.

**Changes:**

- Add `BillingAccountCancelledPayload` to `libs/contracts`.
- Billing consumes `activation.events`:
  - On `ActivationFailed`, cancel an existing `CREATED` account and publish `BillingAccountCancelled`.
  - If the account does not exist yet, store a cancellation marker by `activationId`.
- `handleActivationRequested` checks the marker so a late request does not create an account for a failed activation.
- `activation-api` records `BillingAccountCancelled` in the activation history instead of ignoring it.

**Verification:** provisioning failure produces `ProvisioningFailed`, `ActivationFailed`, and `BillingAccountCancelled`; the billing account is `CANCELLED` in Mongo; the error email still arrives.

**Concepts to learn:** saga compensation, ordering across different topics, idempotent cancellation, race conditions.

### 3. WebSocket — done

**Objective:** the API pushes activation state instead of the UI polling.

**Decisions:** see the phase-level table (REST/WebSocket contract, CORS origins, WebSocket verification). Sequence diagrams: `docs/diagrams/incremento-3-websocket.md`.

**Changes:**

- Add `@nestjs/websockets` and `@nestjs/platform-socket.io` 12.1.3 (same minor as the installed `@nestjs/common`/`@nestjs/core` 12.1.3) and `socket.io` ^4.8.4 to `apps/activation-api`. Add `socket.io-client` ^4.8.4 as a root devDependency and a `ws:probe` root script.
- Add `apps/activation-api/src/config/cors.ts` with the shared origin list; apply it to HTTP (`app.enableCors`) and to Socket.IO (`@WebSocketGateway({ cors })`).
- Add `apps/activation-api/src/activations/activations.snapshot.ts`: the `ActivationSnapshot` type and the `toActivationSnapshot(document)` mapper. Dates are ISO strings; `createdAt` is not part of the snapshot.
- Add `apps/activation-api/src/activations/activations.gateway.ts`: a gateway that broadcasts `activation.updated` to all clients, logs connect/disconnect, and guards a not-yet-initialized server so a WebSocket failure cannot break the saga.
- Add `apps/activation-api/src/activations/activations.publisher.ts`: the provider between the service and the gateway, so the service never imports Socket.IO.
- Emit after every persisted change in `ActivationsService`: creation (`PENDING`), step result (`IN_PROGRESS`), completion (`ACTIVE`), failure (`FAILED`), and history-only events (cancellation or late result). `recordHistoryOnly` changes from `updateOne` to `findOneAndUpdate` to return the updated document.
- `GET /activations/:id` returns the same snapshot as the WebSocket event.
- Add `scripts/ws-probe.mjs`: connects before the POST (so the `PENDING` snapshot is not missed), filters by `activationId`, and checks snapshot order, final state, history, CORS headers and the final `GET`.

**Emission points:**

| When | Method | Status | History |
|---|---|---|---|
| Creation | `create()` | `PENDING` | `ActivationRequested` |
| Step result | `registerStepResult()` | `IN_PROGRESS` | + step event |
| Both steps OK | `completeActivationIfReady()` | `ACTIVE` | + `ActivationCompleted` |
| Failure | `failActivation()` | `FAILED` | + `ActivationFailed` |
| History only | `recordHistoryOnly()` | unchanged | + `BillingAccountCancelled` or late event |

**Verification:**

- `pnpm --filter @poc/activation-api build` and `lint` pass.
- `pnpm ws:probe` receives, in order: `PENDING` -> `IN_PROGRESS` -> `ACTIVE` for the happy path, and `PENDING` -> `IN_PROGRESS` -> `FAILED` for `simulateFailure=provisioning`; the last snapshot matches `GET /activations/:id`.
- `pnpm smoke` stays green.
- CORS: the HTTP preflight and the Socket.IO handshake answer with `access-control-allow-origin` for `http://localhost:5173`.

**Known limitations:** `BillingAccountCancelled` only reaches the timeline when billing had already created the `CREATED` account (otherwise billing stores a tombstone and publishes nothing), so the probe warns instead of failing when it is missing; a Kafka redelivery can duplicate a history entry and emit an extra snapshot (Phase 3); a single `activation-api` instance only (no Socket.IO Redis adapter); snapshots emitted while no client is connected are not replayed, so the UI must `GET` on mount and on reconnect.

**Concepts to learn:** WebSocket vs REST, gateways, push vs pull, reconnect behavior, why `GET` stays as the source of truth.

### 4. React UI

**Objective:** the demo screen.

**Changes:**

- Create `apps/demo-ui` with Vite + React + TypeScript + `socket.io-client`.
- Form with `customerId`, `planId`, and `simulateFailure`.
- Activation list, status badges, per-step badges, and a live timeline.
- Load the initial state with `GET /activations/:id`; update from `activation.updated`.
- Refetch on socket reconnect.
- Links to Mailpit and Kafka UI for the demo.

**Verification:** scenarios 1 and 2 run from the browser and the timeline updates live.

**Concepts to learn:** React state/effects, socket lifecycle, server truth, CORS, development vs production build.

### 5. Packaging, smoke, and documentation

**Objective:** the whole stack starts with one command and the demo is repeatable.

**Changes:**

- Add a multi-stage Dockerfile for the UI (pnpm build → nginx) and the Compose service on `5173`.
- Set `VITE_API_URL` at build time.
- Extend the smoke test with both Phase 2 scenarios, including Mailpit API checks.
- Add `docs/runbook.md` and `docs/demo-script.md`.
- Create the root `README.md` (it does not exist yet): setup, architecture, demo flow, and the Mailpit deviation from the spec.

**Verification:** `docker compose down -v && docker compose up -d --build`, then smoke and a timed two-scenario demo.

**Concepts to learn:** production builds, static serving, build-time env vars, healthchecks, end-to-end tests.

## Definition of Done

- [ ] `docker compose up -d --build` starts the whole stack from scratch.
- [ ] Scenario 1: timeline shows `ActivationRequested`, `BillingAccountCreated`, `ProvisioningCompleted`, `ActivationCompleted`; status `ACTIVE`; welcome email in Mailpit.
- [ ] Scenario 2: timeline shows `ProvisioningFailed`, `ActivationFailed`, `BillingAccountCancelled`; status `FAILED`; billing account `CANCELLED`; error email in Mailpit.
- [ ] The UI reconnects and recovers state with `GET`.
- [ ] `pnpm smoke` covers both scenarios.
- [ ] Runbook and demo script are written.
- [ ] The flow can be explained without reading the code.

## Handoff

- Repo state: Phase 1 plus Phase 2 increments 1, 2 and 3. `notification-service` consumes `activation.events` with group `notification-svc`, stores one document per `{ activationId, eventType }` in `notification.notifications` (unique compound index), and sends the email with `nodemailer` to Mailpit. `ActivationFailedPayload` includes `planId`.
- Compensation: `billing-service` also consumes `activation.events` with group `billing-svc`. On `ActivationFailed` it cancels a `CREATED` account with a status-guarded update, publishes `BillingAccountCancelled` (`{ billingAccountId, planId, reason }`) to `billing.events`, or stores a `CANCELLED` tombstone in `billing.billing_accounts` when the account does not exist yet. The existing `updateOne(... upsert)` in `handleActivationRequested` ignores a late request when the tombstone exists. `activation-api` records `BillingAccountCancelled` only in the activation history; `steps` and `status` do not change.
- Increment 1 verification (2026-11-25): happy path reached `ACTIVE` with the welcome email and document `SENT`; `simulateFailure=provisioning` reached `FAILED` with the error email (`planId`, `failedService`, `reason`); deleting the consumer-group offsets replayed both events without new emails; `pnpm smoke` stayed green.
- Increment 2 verification (2026-11-25): `pnpm smoke` stayed green. `simulateFailure=provisioning` ended `FAILED` with history `ProvisioningFailed` -> `ActivationFailed` -> `BillingAccountCancelled`, billing account `CANCELLED` in Mongo, error email in Mailpit, and billing logs showing the cancellation. A synthetic `ActivationFailed` published before a late `ActivationRequested` created only the `CANCELLED` tombstone; the late request was ignored and no `BillingAccountCreated` was published. A repeated `ActivationFailed` did not publish a second `BillingAccountCancelled`.
- Increment 3 verification (2026-11-25): `pnpm ws:probe` connected before the POST and received the snapshots in order — happy path `PENDING` -> `IN_PROGRESS` -> `IN_PROGRESS` -> `ACTIVE` with history `ActivationRequested` -> `BillingAccountCreated` -> `ProvisioningCompleted` -> `ActivationCompleted`; failure path `PENDING` -> `IN_PROGRESS` -> `IN_PROGRESS` -> `FAILED` -> `FAILED`, where the last snapshot adds `BillingAccountCancelled` to the history without changing the status. CORS answered `access-control-allow-origin: http://localhost:5173` on the HTTP preflight (204) and on the Socket.IO handshake (200). The last snapshot matched `GET /activations/:id`, and `pnpm smoke` stayed green. `GET /activations/:id` now returns the same snapshot shape as the WebSocket event (`activationId` instead of `_id`), and `scripts/smoke-test.mjs` logs `activation.activationId`.
- Known limitations: no `processed_events`, retries or DLQ (Phase 3); a redelivered `BillingAccountCancelled` could append a duplicate history entry; if publishing the cancellation fails after the account is marked `CANCELLED`, there is no retry; cross-topic ordering can still produce a `BillingAccountCreated` after a cancellation in a rare race, but the account ends `CANCELLED`; the notification document is inserted before sending, so an SMTP failure leaves it `FAILED` without retry until Phase 3; the push channel works with a single `activation-api` instance (no Socket.IO Redis adapter) and does not replay snapshots emitted while no client was connected.
- Next session: increment 4 (React UI). Read `AGENTS.md` and the increment 4 section first; update this Status/Handoff and `AGENTS.md` when it lands.
- Baseline commands: `docker compose up -d --build`, `pnpm smoke` and `pnpm ws:probe`.

## References

- `docs/TP8_POC_Activacion_de_Servicios_con_Kafka.md`
- `docs/diagrams/incremento-3-websocket.md`
- `AGENTS.md`
