import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientKafka } from '@nestjs/microservices';
import type { Model } from 'mongoose';
import {
  TOPICS,
  createEnvelope,
  type ActivationRequestedPayload,
  type BillingAccountCreatedPayload,
  type BillingFailedPayload,
  type Envelope,
  type EventType,
} from '@poc/contracts';
import { BILLING_KAFKA_CLIENT } from '../kafka/kafka-producer.module';
import { BillingAccount } from './billing.schema';

type BillingEventPayload = BillingAccountCreatedPayload | BillingFailedPayload;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(BillingAccount.name)
    private readonly accountModel: Model<BillingAccount>,

    @Inject(BILLING_KAFKA_CLIENT)
    private readonly client: ClientKafka,
  ) {}

  async handleActivationRequested(
    envelope: Envelope<ActivationRequestedPayload>,
  ): Promise<void> {
    const { correlationId, customerId, payload } = envelope;

    if (payload.simulateFailure === 'billing') {
      this.logger.warn(
        `Fallo simulado de billing para la activación ${correlationId}`,
      );
      this.publish({
        eventType: 'BillingFailed',
        correlationId,
        customerId,
        payload: { reason: 'simulateFailure=billing' },
      });
      return;
    }

    const billingAccountId = `bil-${correlationId}`;

    // Idempotencia
    // Busca si existe el activationId
    // - Si NO existe, crea un documento nuevo
    // - Si YA existe, no hace nada
    const result = await this.accountModel.updateOne(
      { activationId: correlationId },
      {
        $setOnInsert: {
          activationId: correlationId,
          billingAccountId,
          customerId,
          planId: payload.planId,
          status: 'CREATED',
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
      `Cuenta ${billingAccountId} creada para la activación ${correlationId}`,
    );

    this.publish({
      eventType: 'BillingAccountCreated',
      correlationId,
      customerId,
      payload: { billingAccountId, planId: payload.planId },
    });
  }

  private publish(params: {
    eventType: EventType;
    correlationId: string;
    customerId: string;
    payload: BillingEventPayload;
  }) {
    const envelope = createEnvelope<BillingEventPayload>({
      eventType: params.eventType,
      correlationId: params.correlationId,
      customerId: params.customerId,
      source: 'billing-svc',
      payload: params.payload,
    });

    this.client.emit(TOPICS.billingEvents, {
      key: envelope.customerId,
      value: envelope,
    });

    this.logger.log(
      `${envelope.eventType} publicado en ${TOPICS.billingEvents} (activación=${envelope.correlationId}, eventId=${envelope.eventId}, key=${envelope.customerId})`,
    );
  }
}
