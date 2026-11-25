# syntax=docker/dockerfile:1

# =============================================================================
# Imagen de las apps NestJS del monorepo
# =============================================================================
# Se construye una imagen por app, pasando el nombre como build arg:
#
#   docker build --build-arg APP=activation-api -t activation-api .
#
# Etapas:
#   build   → instala dependencias, compila contracts + app y arma un deploy
#             autocontenido con pnpm deploy (solo dependencias de producción)
#   runtime → imagen limpia de Node que ejecuta el JavaScript compilado
#
# ¿Por qué no copiar node_modules desde la host?
# Porque el node_modules de Windows tiene binarios y symlinks para Windows.
# Dentro del container Linux hay que instalarlo de nuevo.
# =============================================================================

# ---------------------------------------------------------------------------
# 1. BUILD
# ---------------------------------------------------------------------------
FROM node:24.21.0-bookworm-slim AS build

# Versión fijada: la misma que declara package.json (packageManager).
RUN npm install -g pnpm@12.11.2

WORKDIR /app

# Se copian solo los manifiestos primero para aprovechar la caché de Docker:
# mientras no cambien las dependencias, esta capa no se vuelve a instalar.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/activation-api/package.json ./apps/activation-api/
COPY apps/billing-service/package.json ./apps/billing-service/
COPY apps/provisioning-service/package.json ./apps/provisioning-service/
COPY apps/notification-service/package.json ./apps/notification-service/
COPY libs/contracts/package.json ./libs/contracts/

RUN pnpm install --frozen-lockfile

# El build arg se declara después del install para que la capa de dependencias
# sea compartida por todas las imágenes.
ARG APP
RUN test -n "$APP" || (echo "Falta el build arg APP (activation-api | billing-service | provisioning-service | notification-service)" >&2; exit 1)

COPY apps ./apps
COPY libs ./libs

# 1. contracts primero: las apps lo importan y necesitan su dist/.
# 2. La app concreta.
# 3. pnpm deploy: arma /deploy con dist/, package.json y node_modules de
#    producción (incluye @poc/contracts como dependencia del workspace).
RUN pnpm --filter @poc/contracts build \
 && pnpm --filter "@poc/${APP}" build \
 && pnpm --filter "@poc/${APP}" --prod deploy /deploy

# ---------------------------------------------------------------------------
# 2. RUNTIME
# ---------------------------------------------------------------------------
FROM node:24.21.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# /deploy es autocontenido: no depende de /app del stage de build.
COPY --from=build /deploy ./

# node ya existe en la imagen oficial; la app solo necesita leer sus archivos.
USER node

CMD ["node", "dist/main.js"]
