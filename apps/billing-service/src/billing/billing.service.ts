import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientKafka } from '@nestjs/microservices';
import type { Model } from 'mongoose';
import {
  TOPICS,
  createEnvelope,
  type ActivationFailedPayload,
  type ActivationRequestedPayload,
  type BillingAccountCancelledPayload,
  type BillingAccountCreatedPayload,
  type BillingFailedPayload,
  type Envelope,
} from '@poc/contracts';
import { BILLING_KAFKA_CLIENT } from '../kafka/kafka-producer.module';
import { BillingAccount } from './billing.schema';

type BillingEventType =
  | 'BillingAccountCreated'
  | 'BillingFailed'
  | 'BillingAccountCancelled';

type BillingEventPayload =
  | BillingAccountCreatedPayload
  | BillingFailedPayload
  | BillingAccountCancelledPayload;

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
      // Si la activación ya falló, el tombstone existe y un evento tardío
      // no debe republicar el fallo.
      const alreadyCancelled = await this.accountModel.exists({
        activationId: correlationId,
        status: 'CANCELLED',
      });

      if (alreadyCancelled) {
        this.logger.log(
          `Activación ${correlationId} ya cancelada, se ignora el evento tardío`,
        );
        return;
      }

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

    // Idempotencia:
    // - Si no existe ningún documento, inserta la cuenta CREATED.
    // - Si ya existe (evento repetido o tombstone CANCELLED), no inserta nada.
    try {
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

      if (result.upsertedCount === 0) {
        this.logger.log(
          `Activación ${correlationId} ya tiene cuenta o marcador de cancelación, se ignora el evento repetido`,
        );
        return;
      }
    } catch (error) {
      // Este upsert y el tombstone de ActivationFailed pueden competir por el
      // índice único de activationId; el que pierde se considera ya procesado.
      if (this.isDuplicateKey(error)) {
        this.logger.log(
          `Activación ${correlationId} ya procesada en paralelo, se ignora el evento repetido`,
        );
        return;
      }
      throw error;
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

  async handleActivationFailed(
    envelope: Envelope<ActivationFailedPayload>,
  ): Promise<void> {
    const { correlationId, customerId, payload } = envelope;
    const billingAccountId = `bil-${correlationId}`;
    const cancelledAt = new Date();
    const cancellationReason = `activation failed in ${payload.failedService}: ${payload.reason}`;

    // 1. Asegurar que exista un documento. Si la cuenta todavía no existe,
    //    se crea el tombstone CANCELLED. Si ya existe (CREATED o CANCELLED),
    //    $setOnInsert no lo modifica.
    try {
      await this.accountModel.updateOne(
        { activationId: correlationId },
        {
          $setOnInsert: {
            activationId: correlationId,
            billingAccountId,
            customerId,
            planId: payload.planId,
            status: 'CANCELLED',
            cancelledAt,
            cancellationReason,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      // Otro handler (ActivationRequested) insertó el documento en paralelo.
      // El paso 2 se encarga de cancelarlo si quedó CREATED.
      if (!this.isDuplicateKey(error)) throw error;
    }

    // 2. Si la cuenta existe y sigue CREATED, cancelarla de forma atómica.
    //    El filtro por estado hace que un ActivationFailed repetido no vuelva
    //    a publicar BillingAccountCancelled.
    const cancelledAccount = await this.accountModel.findOneAndUpdate(
      { activationId: correlationId, status: 'CREATED' },
      {
        $set: {
          status: 'CANCELLED',
          cancelledAt,
          cancellationReason,
        },
      },
      { returnDocument: 'after' },
    );

    if (!cancelledAccount) {
      this.logger.log(
        `Activación ${correlationId} sin cuenta CREATED para cancelar; marcador de cancelación asegurado`,
      );
      return;
    }

    this.logger.warn(
      `Cuenta ${cancelledAccount.billingAccountId} cancelada (activación=${correlationId}, motivo=${cancellationReason})`,
    );

    this.publish({
      eventType: 'BillingAccountCancelled',
      correlationId,
      customerId,
      payload: {
        billingAccountId: cancelledAccount.billingAccountId,
        planId: cancelledAccount.planId,
        reason: cancellationReason,
      },
    });
  }

  private publish(params: {
    eventType: BillingEventType;
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

  private isDuplicateKey(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
