# POC Activación de Servicios con Kafka — Fase 1

Implementación de la Fase 1 del documento
[`docs/TP8_POC_Activacion_de_Servicios_con_Kafka.md`](docs/TP8_POC_Activacion_de_Servicios_con_Kafka.md):
infraestructura en Docker Compose, `activation-api`, `billing-service` y
`provisioning-service`, con el camino feliz funcionando de punta a punta.

## Requisitos

- Docker Desktop con **Linux containers**.
- Node.js 24 y pnpm 12 solo para correr el smoke test o las apps en modo local.
- Puertos libres: `3000` (API), `8080` (Kafka UI), `9092` (Kafka desde la host)
  y `27017` (Mongo desde la host).

## Levantar todo

```bash
docker compose up -d --build
```

La primera vez tarda unos minutos porque descarga las imágenes y ejecuta
`pnpm install` dentro del build. Después queda cacheado.

Comprobar el estado:

```bash
docker compose ps
```

Esperado:

- `kafka` y `mongo`: `healthy`.
- `kafka-init` y `mongo-init`: `exited (0)` (son jobs de una sola vez).
- `activation-api`, `billing-service` y `provisioning-service`: `running`.

> En un arranque en frío, Kafka tarda unos segundos en dejar listo el group
> coordinator. Durante ese lapso los consumidores pueden registrar
> `not the correct coordinator` y reintentar solos. Es transitorio y no pierde
> eventos: los tres consumidores usan `subscribe: { fromBeginning: true }`.
> El smoke test espera hasta 60 segundos para cubrir ese arranque.

## Verificar el camino feliz

Con el compose levantado:

```bash
pnpm smoke
```

El script hace un `POST /activations`, espera el estado final y verifica que:

- La respuesta inicial sea `202` con `PENDING`.
- La activación termine en `ACTIVE`.
- Billing y provisioning queden en `OK`.
- El historial tenga `ActivationRequested`, `BillingAccountCreated`,
  `ProvisioningCompleted` y `ActivationCompleted`.

También se puede probar a mano desde PowerShell:

```powershell
$body = '{"customerId":"C-1234","planId":"FLOW-FULL"}'
$r = Invoke-WebRequest -Method Post `
  -Uri http://localhost:3000/activations `
  -ContentType 'application/json' `
  -Body $body

$r.StatusCode                    # 202
$activation = $r.Content | ConvertFrom-Json
$activation

Start-Sleep -Seconds 5
Invoke-RestMethod "http://localhost:3000/activations/$($activation.activationId)" |
  ConvertTo-Json -Depth 10
```

El orden entre `BillingAccountCreated` y `ProvisioningCompleted` puede variar:
provisioning simula una demora de 1 a 3 segundos. `ActivationCompleted` debe
quedar último.

## Dónde mirar

| Qué | Dónde |
|---|---|
| API | <http://localhost:3000> |
| Kafka UI | <http://localhost:8080> |
| Logs de las apps | `docker compose logs -f activation-api billing-service provisioning-service` |
| Base de activaciones | `docker compose exec mongo mongosh --quiet --eval "db.getSiblingDB('activation_api').activations.find().pretty()"` |
| Cuentas de billing | `docker compose exec mongo mongosh --quiet --eval "db.getSiblingDB('billing').billing_accounts.find().pretty()"` |
| Órdenes de provisioning | `docker compose exec mongo mongosh --quiet --eval "db.getSiblingDB('provisioning').provisioning_orders.find().pretty()"` |

En Kafka UI se pueden ver los cuatro topics (`activation.requested`,
`billing.events`, `provisioning.events`, `activation.events`), sus tres
particiones y los consumer groups `activation-api`, `billing-svc` y
`provisioning-svc`.

## Cómo está armado Docker

- **Un solo `Dockerfile`** construye las tres apps. Compose le pasa el nombre de
  la app con el build arg `APP`.
- El build es multi-etapa:
  1. instala dependencias con `pnpm install --frozen-lockfile`;
  2. compila `libs/contracts` y la app;
  3. usa `pnpm deploy --prod` para armar una carpeta autocontenida con `dist/` y
     solo las dependencias de producción;
  4. la imagen final solo copia esa carpeta y ejecuta `node dist/main.js`.
- **No se copia el `node_modules` de la host**: `.dockerignore` lo excluye y se
  instala de nuevo dentro de Linux.
- **Los `.env` locales no viajan a la imagen**: el compose inyecta las variables
  de cada container.
- **Los containers se hablan por nombre de servicio**: `kafka:19092` y
  `mongo:27017`. `localhost` dentro de un container es el propio container.
- Kafka tiene dos listeners: `EXTERNAL://localhost:9092` para herramientas de la
  host y `INTERNAL://kafka:19092` para los containers.
- Las apps esperan a `kafka-init` y `mongo-init` con
  `condition: service_completed_successfully`; Mongo se inicializa como replica
  set de un nodo para poder usar transacciones más adelante.
- Las apps no tienen `container_name` para que el escenario de escalar billing
  con `--scale billing-service=2` funcione en Fase 3.

## Desarrollo local (sin reconstruir imágenes)

Para trabajar con hot reload, se puede levantar solo la infraestructura:

```bash
docker compose up -d kafka kafka-init mongo mongo-init kafka-ui
```

Y correr las apps en la host:

```bash
pnpm --filter @poc/activation-api start:dev
pnpm --filter @poc/billing-service start:dev
pnpm --filter @poc/provisioning-service start:dev
```

Los `.env` de las apps ya apuntan a `localhost:9092` y `localhost:27017`.

> No corras al mismo tiempo la versión local y la de Docker de un servicio que
> comparte `KAFKA_GROUP_ID`: Kafka repartiría las particiones entre ambas y el
> flujo se volvería confuso.

## Bajar el entorno

```bash
docker compose down
```

Kafka y Mongo no tienen volúmenes propios: `down` borra el estado y deja el
entorno limpio para la próxima demo.

## Alcance de esta fase

Incluido: infraestructura, `activation-api`, billing, provisioning y camino
feliz (RF-02 a RF-05, RNF-01, RNF-02 básico y RNF-06).

Quedan para fases siguientes: UI con timeline por WebSocket, notification y
Mailhog, compensación de billing, idempotencia completa, reintentos, DLQ,
`crm-analytics` y el servicio `loyalty`.
