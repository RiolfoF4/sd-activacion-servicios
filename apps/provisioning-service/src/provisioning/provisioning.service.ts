import { randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientKafka } from '@nestjs/microservices';
import type { Model } from 'mongoose';
import {
  TOPICS,
  createEnvelope,
  type ActivationRequestedPayload,
  type Envelope,
  type EventType,
  type ProvisioningCompletedPayload,
  type ProvisioningFailedPayload,
} from '@poc/contracts';
import { PROVISIONING_KAFKA_CLIENT } from '../kafka/kafka-producer.module';
import { ProvisioningOrder } from './provisioning.schema';

type ProvisioningEventPayload =
  | ProvisioningCompletedPayload
  | ProvisioningFailedPayload;

const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 3000;

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    @InjectModel(ProvisioningOrder.name)
    private readonly orderModel: Model<ProvisioningOrder>,

    @Inject(PROVISIONING_KAFKA_CLIENT)
    private readonly client: ClientKafka,
  ) {}

  async handleActivationRequested(
    envelope: Envelope<ActivationRequestedPayload>,
  ): Promise<void> {
    const { correlationId, customerId, payload } = envelope;

    // El aprovisionamiento simula tardar entre 1 y 3 segundos.
    const delayMs = randomInt(MIN_DELAY_MS, MAX_DELAY_MS + 1);
    this.logger.log(
      `Aprovisionando activación ${correlationId} (espera ${delayMs} ms)`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (payload.simulateFailure === 'provisioning') {
      this.logger.warn(
        `Fallo simulado de provisioning para la activación ${correlationId}`,
      );
      this.publish({
        eventType: 'ProvisioningFailed',
        correlationId,
        customerId,
        payload: { reason: 'simulateFailure=provisioning' },
      });
      return;
    }

    const provisioningOrderId = `prov-${correlationId}`;

    // Idempotencia
    // Busca si existe el activationId
    // - Si NO existe, crea un documento nuevo
    // - Si YA existe, no hace nada
    const result = await this.orderModel.updateOne(
      { activationId: correlationId },
      {
        $setOnInsert: {
          activationId: correlationId,
          provisioningOrderId,
          customerId,
          planId: payload.planId,
          status: 'COMPLETED',
        },
      },
      { upsert: true },
    );

    // Si no se creó ningún documento, salir
    if (result.upsertedCount === 0) {
      this.logger.log(
        `Activación ${correlationId} ya procesada, se ignora el evento repetido`,
      );
      return;
    }

    this.logger.log(
      `Orden ${provisioningOrderId} aprovisionada para la activación ${correlationId}`,
    );

    this.publish({
      eventType: 'ProvisioningCompleted',
      correlationId,
      customerId,
      payload: { provisioningOrderId, planId: payload.planId },
    });
  }

  private publish(params: {
    eventType: EventType;
    correlationId: string;
    customerId: string;
    payload: ProvisioningEventPayload;
  }) {
    const envelope = createEnvelope<ProvisioningEventPayload>({
      eventType: params.eventType,
      correlationId: params.correlationId,
      customerId: params.customerId,
      source: 'provisioning-svc',
      payload: params.payload,
    });

    this.client.emit(TOPICS.provisioningEvents, {
      key: envelope.customerId,
      value: envelope,
    });

    this.logger.log(
      `${envelope.eventType} publicado en ${TOPICS.provisioningEvents} (eventId=${envelope.eventId})`,
    );
  }
}
