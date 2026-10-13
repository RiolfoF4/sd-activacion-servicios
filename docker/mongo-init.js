// =============================================================================
// mongo-init.js — Inicializa el replica set de un solo nodo (corre en mongo-init)
// =============================================================================
// Se ejecuta con: mongosh --host mongo --file /mongo-init.js
//
// ¿Para qué? Mongo no permite transacciones multi-documento en modo standalone.
// Inicializar el replica set "rs0" con un único miembro es el mínimo necesario
// para que funcionen (sección 09: outbox transaccional e idempotencia).
//
// Idempotente: si el replica set ya está inicializado, no hace nada.
// =============================================================================

const REPLICA_SET = "rs0";
const MEMBER = "mongo:27017";   // nombre resoluble DENTRO de la red de compose
const PRIMARY = 1;             // myState de PRIMARY en rs.status()
const MAX_WAIT_MS = 30000;

// --- 1. Inicializar si hace falta -------------------------------------------
// rs.status() lanza un error si el replica set nunca fue inicializado
// ("No replset config has been received"), y devuelve estado si ya existe.
let yaInicializado = false;
try {
  rs.status();
  yaInicializado = true;
  print(`[mongo-init] Replica set "${REPLICA_SET}" ya inicializado, no hay nada que hacer.`);
} catch (e) {
  // Esperado en el primer arranque: continúa y lo inicializa abajo
}

if (!yaInicializado) {
  print(`[mongo-init] Inicializando replica set "${REPLICA_SET}" con miembro ${MEMBER}...`);
  rs.initiate({
    _id: REPLICA_SET,
    members: [{ _id: 0, host: MEMBER }],
  });
}

// --- 2. Esperar a que haya un PRIMARY ----------------------------------------
// rs.initiate() devuelve al instante, pero la elección es asíncrona.
// Este job NO termina hasta que el nodo esté en PRIMARY, así quien dependa de
// él (condition: service_completed_successfully) sabe que hay primario listo.
const inicio = Date.now();
while (Date.now() - inicio < MAX_WAIT_MS) {
  try {
    if (rs.status().myState === PRIMARY) {
      print("[mongo-init] Nodo en estado PRIMARY. Listo ✓");
      quit(0);
    }
  } catch (e) {
    // Todavía en proceso de elección: esperar y reintentar
  }
  sleep(500);
}

print("[mongo-init] ERROR: timeout esperando a que el nodo sea PRIMARY.");
quit(1);
