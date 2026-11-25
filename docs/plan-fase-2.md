# Phase 2 Plan — Visible

**Status:** in progress — increment 2 verified (2026-11-25)
**Current phase:** 2
**Next increment:** 3 — WebSocket
**Baseline:** Phase 1 verified; increments 1 and 2 verified.

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

### 3. WebSocket

**Objective:** the API pushes activation state instead of the UI polling.

**Changes:**

- Add `@nestjs/websockets`, `@nestjs/platform-socket.io`, and `socket.io`.
- Enable CORS for HTTP and for Socket.IO (two separate configurations).
- Add an activation gateway that emits `activation.updated` with the full snapshot:
  `activationId`, `customerId`, `planId`, `status`, `simulateFailure`, `steps`, `history`, `updatedAt`.
- Emit after creation, each step result, completion, failure, and cancellation.
- Keep a small publisher provider between the service and the gateway.

**Verification:** a small `scripts/ws-probe.mjs` (or browser console) receives the snapshots in order for one activation.

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

- Repo state: Phase 1 plus Phase 2 increments 1 and 2. `notification-service` consumes `activation.events` with group `notification-svc`, stores one document per `{ activationId, eventType }` in `notification.notifications` (unique compound index), and sends the email with `nodemailer` to Mailpit. `ActivationFailedPayload` includes `planId`.
- Compensation: `billing-service` also consumes `activation.events` with group `billing-svc`. On `ActivationFailed` it cancels a `CREATED` account with a status-guarded update, publishes `BillingAccountCancelled` (`{ billingAccountId, planId, reason }`) to `billing.events`, or stores a `CANCELLED` tombstone in `billing.billing_accounts` when the account does not exist yet. The existing `updateOne(... upsert)` in `handleActivationRequested` ignores a late request when the tombstone exists. `activation-api` records `BillingAccountCancelled` only in the activation history; `steps` and `status` do not change.
- Increment 1 verification (2026-11-25): happy path reached `ACTIVE` with the welcome email and document `SENT`; `simulateFailure=provisioning` reached `FAILED` with the error email (`planId`, `failedService`, `reason`); deleting the consumer-group offsets replayed both events without new emails; `pnpm smoke` stayed green.
- Increment 2 verification (2026-11-25): `pnpm smoke` stayed green. `simulateFailure=provisioning` ended `FAILED` with history `ProvisioningFailed` -> `ActivationFailed` -> `BillingAccountCancelled`, billing account `CANCELLED` in Mongo, error email in Mailpit, and billing logs showing the cancellation. A synthetic `ActivationFailed` published before a late `ActivationRequested` created only the `CANCELLED` tombstone; the late request was ignored and no `BillingAccountCreated` was published. A repeated `ActivationFailed` did not publish a second `BillingAccountCancelled`.
- Known limitations: no `processed_events`, retries or DLQ (Phase 3); a redelivered `BillingAccountCancelled` could append a duplicate history entry; if publishing the cancellation fails after the account is marked `CANCELLED`, there is no retry; cross-topic ordering can still produce a `BillingAccountCreated` after a cancellation in a rare race, but the account ends `CANCELLED`; the notification document is inserted before sending, so an SMTP failure leaves it `FAILED` without retry until Phase 3.
- Next session: increment 3 (WebSocket). Read `AGENTS.md` and the increment 3 section first; update this Status/Handoff and `AGENTS.md` when it lands.
- Baseline commands: `docker compose up -d --build` and `pnpm smoke`.

## References

- `docs/TP8_POC_Activacion_de_Servicios_con_Kafka.md`
- `AGENTS.md`
