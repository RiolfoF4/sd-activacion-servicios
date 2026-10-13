#!/usr/bin/env bash
# =============================================================================
# create-topics.sh — Crea los topics de la POC (corre en el container kafka-init)
# =============================================================================
# Sale con error si algo falla (set -e) → kafka-init queda en "exited (1)" y se
# ve en `docker compose ps`, en vez de fallar en silencio.
# =============================================================================
set -euo pipefail

# Conectamos por el listener INTERNAL: kafka-init es otro container de la red.
# Los scripts viven en /opt/kafka/bin y esa ruta NO está en el $PATH de la imagen,
# por eso se usa la ruta absoluta en cada invocación.
KAFKA_BIN="/opt/kafka/bin"
BOOTSTRAP="kafka:19092"
PARTITIONS=3
REPLICATION_FACTOR=1        # 1 broker → 1 réplica (no hay a quién replicar)
RETENTION_MS=604800000      # 7 días = 7 * 24 * 60 * 60 * 1000

# Topics de negocio (sección 06 del documento)
BUSINESS_TOPICS=(
  activation.requested
  billing.events
  provisioning.events
  activation.events
)

for topic in "${BUSINESS_TOPICS[@]}"; do
  # 1. El topic de negocio
  "$KAFKA_BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" \
    --create --if-not-exists \
    --topic "$topic" \
    --partitions "$PARTITIONS" \
    --replication-factor "$REPLICATION_FACTOR" \
    --config "retention.ms=$RETENTION_MS"

  # 2. Su DLQ (misma familia de nombres: <topic>.dlq)
  "$KAFKA_BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" \
    --create --if-not-exists \
    --topic "${topic}.dlq" \
    --partitions "$PARTITIONS" \
    --replication-factor "$REPLICATION_FACTOR" \
    --config "retention.ms=$RETENTION_MS"
done

echo "===> Topics creados (o ya existentes):"
"$KAFKA_BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" --list
