import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIVATION_UPDATED_EVENT,
  ActivationsGateway,
} from './activations.gateway';
import type { ActivationSnapshot } from './activations.snapshot';
import { toActivationSnapshot } from './activations.snapshot';
import type { ActivationDocument } from './activations.schema';

// Publisher entre el servicio y el gateway.
//
// El servicio no importa nada de Socket.IO: solo pide "publicá este
// snapshot". Así el agregado de la saga no depende del transporte y se podría
// reemplazar el WebSocket por otro canal sin tocar la lógica.
@Injectable()
export class ActivationsPublisher {
  private readonly logger = new Logger(ActivationsPublisher.name);

  constructor(private readonly gateway: ActivationsGateway) {}

  publishSnapshot(activation: ActivationDocument): void {
    const snapshot: ActivationSnapshot = toActivationSnapshot(activation);

    this.gateway.emitSnapshot(snapshot);

    this.logger.debug(
      `${ACTIVATION_UPDATED_EVENT} emitido (activación=${snapshot.activationId}, status=${snapshot.status}, eventos=${snapshot.history.length})`,
    );
  }
}
