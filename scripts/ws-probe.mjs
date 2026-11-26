// =============================================================================
// ws-probe.mjs — Verifica el canal WebSocket del Incremento 3 (Fase 2)
// =============================================================================
// Uso:
//   pnpm ws:probe
//   API_URL=http://localhost:3000 pnpm ws:probe
//
// Requiere que el compose esté levantado:
//   docker compose up -d --build
//
// Qué comprueba:
//   - El preflight de HTTP y el handshake de Socket.IO responden con
//     access-control-allow-origin para el origen de la UI (:5173).
//   - Los snapshots 'activation.updated' llegan en orden para una activación:
//     PENDING -> IN_PROGRESS -> ACTIVE (camino feliz) y
//     PENDING -> IN_PROGRESS -> FAILED (con simulateFailure=provisioning).
//   - El último snapshot coincide con GET /activations/:id, que sigue siendo
//     la fuente de verdad.
// =============================================================================

import { request } from 'node:http';
import { io } from 'socket.io-client';

const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);
const ORIGIN = process.env.WS_PROBE_ORIGIN ?? 'http://localhost:5173';
const TIMEOUT_MS = Number(process.env.WS_PROBE_TIMEOUT_MS ?? 60_000);
const POLL_MS = 200;
// Margen para que la compensación (BillingAccountCancelled) llegue después
// del FAILED. Si no llega, se avisa: puede ser que billing no haya creado la
// cuenta y solo haya dejado el tombstone CANCELLED.
const CANCELLATION_GRACE_MS = 5_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message, details) {
  console.error(`\n[ws-probe] ERROR: ${message}`);
  if (details !== undefined) {
    console.error(JSON.stringify(details, null, 2));
  }
  process.exit(1);
}

function check(condition, message, details) {
  if (!condition) fail(message, details);
}

// El probe corre en Node, no en el navegador: CORS no aplica para él. Los
// headers de CORS se revisan aparte con una request cruda (node:http), que
// sí permite mandar el header Origin.
async function apiFetch(path, options = {}) {
  try {
    return await fetch(`${API_URL}${path}`, {
      ...options,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    fail(`no se pudo conectar con ${path}`, { error: String(error) });
  }
}

async function waitForApi() {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    try {
      // GET de un id inexistente: si la API responde 404, ya está escuchando.
      const response = await fetch(`${API_URL}/activations/ws-probe-ready`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 404) return;
    } catch {
      // La API todavía no acepta conexiones: reintentar.
    }
    await sleep(POLL_MS);
  }
  fail(`la API no respondió en ${TIMEOUT_MS} ms (${API_URL})`);
}

function rawRequest(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${API_URL}${path}`, { method, headers }, (res) => {
      res.resume();
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers }),
      );
    });
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function checkCors() {
  const preflight = await rawRequest('/activations', {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });

  const preflightOrigin = preflight.headers['access-control-allow-origin'];
  check(
    preflightOrigin === ORIGIN || preflightOrigin === '*',
    `el preflight de HTTP no habilitó CORS para ${ORIGIN}`,
    preflight,
  );

  const handshake = await rawRequest('/socket.io/?EIO=4&transport=polling', {
    headers: { Origin: ORIGIN },
  });

  const handshakeOrigin = handshake.headers['access-control-allow-origin'];
  check(
    handshakeOrigin === ORIGIN || handshakeOrigin === '*',
    `el handshake de Socket.IO no habilitó CORS para ${ORIGIN}`,
    handshake,
  );

  console.log(
    `[ws-probe] CORS OK: preflight HTTP (${preflight.status}) y handshake Socket.IO (${handshake.status}) permiten ${ORIGIN}`,
  );
}

function connectSocket() {
  return new Promise((resolve, reject) => {
    const socket = io(API_URL, {
      forceNew: true,
      reconnection: false,
      timeout: 10_000,
    });

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('timeout conectando al WebSocket'));
    }, 10_000);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

async function createActivation(customerId, simulateFailure) {
  const body = { customerId, planId: 'FLOW-FULL' };
  if (simulateFailure) body.simulateFailure = simulateFailure;

  const response = await apiFetch('/activations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const created = await response.json().catch(() => undefined);

  check(
    response.status === 202,
    `POST /activations devolvió ${response.status}, se esperaba 202`,
    created,
  );
  check(created?.activationId, 'la respuesta no tiene activationId', created);

  return created.activationId;
}

async function runScenario({
  label,
  simulateFailure,
  expectedStatus,
  requiredHistory,
  expectSteps,
}) {
  const customerId = `C-WSPROBE-${Date.now()}-${label}`;
  const socket = await connectSocket();

  // Se guardan TODOS los snapshots, incluso los que llegan antes de que la
  // respuesta del POST nos dé el activationId: el snapshot PENDING puede
  // viajar más rápido que la respuesta HTTP.
  const snapshots = [];
  socket.on('activation.updated', (snapshot) => {
    snapshots.push(snapshot);
  });

  const activationId = await createActivation(customerId, simulateFailure);

  const started = Date.now();
  let final;
  while (Date.now() - started < TIMEOUT_MS) {
    final = snapshots
      .filter((snapshot) => snapshot.activationId === activationId)
      .at(-1);
    if (final?.status === expectedStatus) break;
    await sleep(POLL_MS);
  }

  // La lista se recalcula cuando haga falta: durante la ventana de gracia
  // puede seguir llegando snapshots (por ejemplo, el de la compensación).
  const snapshotsForActivation = () =>
    snapshots.filter((snapshot) => snapshot.activationId === activationId);

  let received = snapshotsForActivation();
  check(
    received.length > 0,
    `no llegó ningún snapshot para ${activationId}`,
    { totalSnapshots: snapshots.length },
  );
  check(
    final?.status === expectedStatus,
    `la activación ${activationId} terminó en ${final?.status}, se esperaba ${expectedStatus}`,
    received.at(-1),
  );

  // En el camino de fallo la compensación puede llegar un poco después del
  // FAILED: se le da una ventana breve antes de seguir.
  let cancellationObserved = received.some((snapshot) =>
    snapshot.history.some(
      (entry) => entry.eventType === 'BillingAccountCancelled',
    ),
  );
  if (expectedStatus === 'FAILED' && !cancellationObserved) {
    const deadline = Date.now() + CANCELLATION_GRACE_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      cancellationObserved = snapshotsForActivation().some((snapshot) =>
        snapshot.history.some(
          (entry) => entry.eventType === 'BillingAccountCancelled',
        ),
      );
      if (cancellationObserved) break;
    }
    if (!cancellationObserved) {
      console.warn(
        '[ws-probe] AVISO: no llegó BillingAccountCancelled. Puede ser que billing no haya alcanzado a crear la cuenta (dejó solo el tombstone CANCELLED).',
      );
    }
  }

  // Con la ventana de gracia ya vencida se vuelve a tomar el último snapshot:
  // puede ser más nuevo que el que se vio al detectar el estado terminal.
  received = snapshotsForActivation();
  final = received.at(-1);

  // Orden: el primero es PENDING, hay un IN_PROGRESS y el último es terminal.
  check(
    received[0].status === 'PENDING',
    `el primer snapshot debería ser PENDING y llegó ${received[0].status}`,
    received[0],
  );
  check(
    received.some((snapshot) => snapshot.status === 'IN_PROGRESS'),
    'nunca se recibió un snapshot IN_PROGRESS',
    received.map((snapshot) => snapshot.status),
  );

  // Ni updatedAt ni el historial pueden retroceder entre snapshots.
  let previousUpdatedAt = 0;
  let previousHistoryLength = 0;
  for (const snapshot of received) {
    for (const field of [
      'activationId',
      'customerId',
      'planId',
      'status',
      'simulateFailure',
      'updatedAt',
    ]) {
      check(
        snapshot[field] !== undefined,
        `falta el campo ${field} en el snapshot`,
        snapshot,
      );
    }
    check(
      Array.isArray(snapshot.history),
      'el snapshot no trae history como array',
      snapshot,
    );
    check(
      snapshot.steps !== null && typeof snapshot.steps === 'object',
      'el snapshot no trae steps',
      snapshot,
    );

    const updatedAt = Date.parse(snapshot.updatedAt);
    check(
      !Number.isNaN(updatedAt),
      'un snapshot viene sin updatedAt válido',
      snapshot,
    );
    check(
      updatedAt >= previousUpdatedAt,
      'los snapshots llegaron fuera de orden (updatedAt retrocedió)',
      { previousUpdatedAt, updatedAt, snapshot },
    );
    check(
      snapshot.history.length >= previousHistoryLength,
      'el historial retrocedió entre snapshots',
      snapshot,
    );

    previousUpdatedAt = updatedAt;
    previousHistoryLength = snapshot.history.length;
  }

  const historyTypes = final.history.map((entry) => entry.eventType);
  for (const eventType of requiredHistory) {
    check(
      historyTypes.includes(eventType),
      `falta ${eventType} en el historial`,
      final.history,
    );
  }

  for (const [service, expected] of Object.entries(expectSteps)) {
    check(
      final.steps?.[service]?.status === expected,
      `el paso ${service} quedó en ${final.steps?.[service]?.status}, se esperaba ${expected}`,
      final.steps,
    );
  }

  // El GET tiene que contar la misma historia que el último snapshot.
  const response = await apiFetch(`/activations/${activationId}`);
  check(
    response.ok,
    `GET /activations/${activationId} devolvió ${response.status}`,
    null,
  );
  const fromGet = await response.json();

  check(
    fromGet.activationId === activationId,
    'el GET no devolvió el activationId esperado',
    fromGet,
  );
  check(
    fromGet.status === final.status,
    `el GET dice ${fromGet.status} y el último snapshot ${final.status}`,
    { fromGet, final },
  );
  check(
    fromGet.history.length >= final.history.length,
    'el GET tiene menos historial que el último snapshot',
    { fromGet, final },
  );
  for (const [service, expected] of Object.entries(expectSteps)) {
    check(
      fromGet.steps?.[service]?.status === expected,
      `el GET dice que ${service} quedó en ${fromGet.steps?.[service]?.status}, se esperaba ${expected}`,
      fromGet.steps,
    );
  }

  socket.close();

  return {
    activationId,
    status: final.status,
    cancellationObserved,
    snapshots: received.map((snapshot) => ({
      status: snapshot.status,
      updatedAt: snapshot.updatedAt,
      history: snapshot.history.map((entry) => entry.eventType),
    })),
  };
}

await waitForApi();
await checkCors();

console.log('[ws-probe] Escenario 1: camino feliz');
const happy = await runScenario({
  label: 'happy',
  simulateFailure: undefined,
  expectedStatus: 'ACTIVE',
  requiredHistory: [
    'ActivationRequested',
    'BillingAccountCreated',
    'ProvisioningCompleted',
    'ActivationCompleted',
  ],
  expectSteps: { billing: 'OK', provisioning: 'OK' },
});

console.log('[ws-probe] Escenario 2: fallo en provisioning');
const failure = await runScenario({
  label: 'failure',
  simulateFailure: 'provisioning',
  expectedStatus: 'FAILED',
  requiredHistory: [
    'ActivationRequested',
    'ProvisioningFailed',
    'ActivationFailed',
  ],
  expectSteps: { provisioning: 'FAILED' },
});

console.log(
  JSON.stringify(
    {
      happy: {
        activationId: happy.activationId,
        status: happy.status,
        snapshots: happy.snapshots.map((snapshot) => ({
          status: snapshot.status,
          history: snapshot.history,
        })),
      },
      failure: {
        activationId: failure.activationId,
        status: failure.status,
        cancellationObserved: failure.cancellationObserved,
        snapshots: failure.snapshots.map((snapshot) => ({
          status: snapshot.status,
          history: snapshot.history,
        })),
      },
    },
    null,
    2,
  ),
);

console.log('\n[ws-probe] OK: snapshots por WebSocket verificados en los dos escenarios.');
process.exit(0);
