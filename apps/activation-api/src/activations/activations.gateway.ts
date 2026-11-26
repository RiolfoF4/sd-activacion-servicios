import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { CORS_ORIGINS } from '../config/cors';
import type { ActivationSnapshot } from './activations.snapshot';

export const ACTIVATION_UPDATED_EVENT = 'activation.updated';

// Canal de push de la POC: difunde a todos los clientes el snapshot de la
// activación que acaba de cambiar.
//
// No hay salas ni suscripciones: cada cliente recibe todos los snapshots y
// filtra por activationId. Para la demo es más simple y evita estado extra
// en el servidor. El CORS de Socket.IO va acá porque el handshake del
// navegador es un request HTTP distinto del que hace la API REST.
@WebSocketGateway({
  cors: { origin: CORS_ORIGINS },
})
export class ActivationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ActivationsGateway.name);

  @WebSocketServer()
  private server: Server;

  handleConnection(client: Socket): void {
    this.logger.log(`Cliente WebSocket conectado (socketId=${client.id})`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Cliente WebSocket desconectado (socketId=${client.id})`);
  }

  emitSnapshot(snapshot: ActivationSnapshot): void {
    // app.init() registra el módulo de WebSockets antes de arrancar los
    // consumidores de Kafka, así que el servidor debería existir. El guard
    // está para que un WebSocket sin servidor listo nunca rompa la saga.
    if (!this.server) {
      this.logger.warn(
        `No se pudo emitir ${ACTIVATION_UPDATED_EVENT}: el servidor de WebSocket todavía no está inicializado`,
      );
      return;
    }

    try {
      this.server.emit(ACTIVATION_UPDATED_EVENT, snapshot);
    } catch (error) {
      // Un fallo en el canal de push nunca debe romper la saga: el estado
      // ya está guardado en Mongo y el cliente lo recupera con un GET.
      this.logger.error(
        `Error al emitir ${ACTIVATION_UPDATED_EVENT} (activación=${snapshot.activationId}): ${String(error)}`,
      );
    }
  }
}
