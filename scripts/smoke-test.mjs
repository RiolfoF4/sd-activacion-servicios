// =============================================================================
// smoke-test.mjs — Verifica el camino feliz de la Fase 1
// =============================================================================
// Uso:
//   pnpm smoke
//   API_URL=http://localhost:3000 pnpm smoke
//
// Requiere que el compose esté levantado:
//   docker compose up -d --build
//
// Qué comprueba:
//   RF-02: POST /activations responde 202 con PENDING.
//   RF-03: la activación se crea y se publica ActivationRequested (indirecto:
//          sin ese evento, billing/provisioning no responderían).
//   RF-04: billing y provisioning publican sus resultados.
//   RF-05: la activación termina ACTIVE y se registra ActivationCompleted.
// =============================================================================

const API_URL = (process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");
// 60 s: en un arranque en frío Kafka puede tardar ~20 s en dejar listo el
// group coordinator y los consumidores se reintentan solos.
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 60_000);
const POLL_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message, details) {
  console.error(`\n[smoke] ERROR: ${message}`);
  if (details !== undefined) {
    console.error(JSON.stringify(details, null, 2));
  }
  process.exit(1);
}

async function waitForApi() {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    try {
      // GET de un id inexistente: si la API responde 404, ya está escuchando.
      const response = await fetch(`${API_URL}/activations/smoke-ready`);
      if (response.status === 404) return;
    } catch {
      // La API todavía no acepta conexiones: reintentar.
    }
    await sleep(POLL_MS);
  }
  fail(`la API no respondió en ${TIMEOUT_MS} ms (${API_URL})`);
}

async function createActivation() {
  const body = {
    customerId: `C-SMOKE-${Date.now()}`,
    planId: "FLOW-FULL",
  };

  let response;
  try {
    response = await fetch(`${API_URL}/activations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    fail("no se pudo conectar con POST /activations", { error: String(error) });
  }

  const created = await response.json().catch(() => undefined);

  if (response.status !== 202) {
    fail(`POST /activations devolvió ${response.status}, se esperaba 202`, created);
  }
  if (!created?.activationId || created.status !== "PENDING") {
    fail("la respuesta no tiene activationId y status PENDING", created);
  }

  return created;
}

async function waitForFinalState(activationId) {
  const started = Date.now();

  while (Date.now() - started < TIMEOUT_MS) {
    const response = await fetch(`${API_URL}/activations/${activationId}`);
    if (response.ok) {
      const activation = await response.json();
      if (activation.status === "ACTIVE" || activation.status === "FAILED") {
        return activation;
      }
    }
    await sleep(POLL_MS);
  }

  fail(`la activación ${activationId} no terminó en ${TIMEOUT_MS} ms`);
}

await waitForApi();
const created = await createActivation();
console.log(`[smoke] Activación creada: ${created.activationId} (${created.status})`);

const activation = await waitForFinalState(created.activationId);

if (activation.status !== "ACTIVE") {
  fail(`la activación terminó en ${activation.status}, se esperaba ACTIVE`, activation);
}

if (activation.steps?.billing?.status !== "OK") {
  fail("billing no quedó en OK", activation.steps);
}
if (activation.steps?.provisioning?.status !== "OK") {
  fail("provisioning no quedó en OK", activation.steps);
}

const historyTypes = (activation.history ?? []).map((entry) => entry.eventType);
const expectedEvents = [
  "ActivationRequested",
  "BillingAccountCreated",
  "ProvisioningCompleted",
  "ActivationCompleted",
];
const missing = expectedEvents.filter((eventType) => !historyTypes.includes(eventType));

if (missing.length > 0) {
  fail(`faltan eventos en el historial: ${missing.join(", ")}`, activation.history);
}
if (historyTypes.at(-1) !== "ActivationCompleted") {
  fail("ActivationCompleted no es el último evento del historial", activation.history);
}

console.log(
  JSON.stringify(
    {
      activationId: activation._id,
      status: activation.status,
      steps: activation.steps,
      history: historyTypes,
    },
    null,
    2,
  ),
);
console.log("\n[smoke] OK: camino feliz de Fase 1 verificado.");
