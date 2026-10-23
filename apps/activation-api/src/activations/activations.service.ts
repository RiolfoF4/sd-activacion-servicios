import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientKafka } from '@nestjs/microservices';
import type { Model } from 'mongoose';
import {
  TOPICS,
  createEnvelope,
  type ActivationCompletedPayload,
  type ActivationFailedPayload,
  type ActivationRequestedPayload,
  type BillingAccountCreatedPayload,
  type BillingFailedPayload,
  type Envelope,
  type ProvisioningCompletedPayload,
  type ProvisioningFailedPayload,
} from '@poc/contracts';
import { Activation, ActivationDocument } from './activations.schema';
import { CreateActivationDto } from './dto/create-activation.dto';
import { KAFKA_CLIENT } from './kafka/kafka-producer.module';

type BillingResultPayload = BillingAccountCreatedPayload | BillingFailedPayload;
type ProvisioningResultPayload =
  | ProvisioningCompletedPayload
  | ProvisioningFailedPayload;
type ActivationResultPayload =
  | ActivationCompletedPayload
  | ActivationFailedPayload;

@Injectable()
export class ActivationsService {
  private readonly logger = new Logger(ActivationsService.name);

  constructor(
    @InjectModel(Activation.name) private activationModel: Model<Activation>,

    @Inject(KAFKA_CLIENT)
    private readonly client: ClientKafka,
  ) {}

  private newActivationId(): string {
    const len = 6;
    return `act-${randomUUID().replace(/-/g, '').slice(0, len)}`;
  }

  private publish<T>(topic: string, envelope: Envelope<T>): void {
    this.client.emit(topic, {
      key: envelope.customerId,
      value: envelope,
    });

    this.logger.log(
      `${envelope.eventType} publicado en ${topic} (activación=${envelope.correlationId}, eventId=${envelope.eventId}, key=${envelope.customerId})`,
    );
  }

  async create(
    createActivationDto: CreateActivationDto,
  ): Promise<ActivationDocument> {
    const { customerId, planId, simulateFailure } = createActivationDto;
    const activationId = this.newActivationId();

    const requestedEvent = createEnvelope<ActivationRequestedPayload>({
      correlationId: activationId,
      customerId,
      eventType: 'ActivationRequested',
      source: 'activation-api',
      payload: {
        channel: 'web',
        planId,
        simulateFailure: simulateFailure ?? 'none',
      },
    });

    const createdActivation = new this.activationModel({
      _id: activationId,
      customerId,
      planId,
      simulateFailure,
      history: [
        {
          eventType: requestedEvent.eventType,
          at: new Date(requestedEvent.occurredAt),
        },
      ],
    });

    const savedActivation = await createdActivation.save();

    this.logger.log(
      `Activación ${savedActivation._id} creada (cliente=${customerId}, plan=${planId}, fallo=${savedActivation.simulateFailure})`,
    );

    this.publish(TOPICS.activationRequested, requestedEvent);

    return savedActivation;
  }

  async handleBillingResult(
    envelope: Envelope<BillingResultPayload>,
  ): Promise<void> {
    if (envelope.eventType === 'BillingFailed') {
      const { reason } = envelope.payload as BillingFailedPayload;
      await this.registerStepResult('billing', envelope, 'FAILED', reason);
      return;
    }

    if (envelope.eventType === 'BillingAccountCreated') {
      await this.registerStepResult('billing', envelope, 'OK');
      return;
    }

    this.logger.warn(
      `Evento de billing ignorado (activación=${envelope.correlationId}, eventType=${envelope.eventType})`,
    );
  }

  async handleProvisioningResult(
    envelope: Envelope<ProvisioningResultPayload>,
  ): Promise<void> {
    if (envelope.eventType === 'ProvisioningFailed') {
      const { reason } = envelope.payload as ProvisioningFailedPayload;
      await this.registerStepResult('provisioning', envelope, 'FAILED', reason);
      return;
    }

    if (envelope.eventType === 'ProvisioningCompleted') {
      await this.registerStepResult('provisioning', envelope, 'OK');
      return;
    }

    this.logger.warn(
      `Evento de provisioning ignorado (activación=${envelope.correlationId}, eventType=${envelope.eventType})`,
    );
  }

  async findById(id: string): Promise<ActivationDocument | null> {
    return this.activationModel.findById(id).exec();
  }

  private async registerStepResult(
    service: 'billing' | 'provisioning',
    envelope: Envelope<unknown>,
    status: 'OK' | 'FAILED',
    failureReason?: string,
  ): Promise<void> {
    const at = new Date();
    const updatedActivation = await this.activationModel.findOneAndUpdate(
      {
        _id: envelope.correlationId,
        status: { $in: ['PENDING', 'IN_PROGRESS'] },
      },
      {
        $set: {
          [`steps.${service}`]: { status, at },
          status: 'IN_PROGRESS',
        },
        $push: {
          history: {
            eventType: envelope.eventType,
            at,
          },
        },
      },
      { returnDocument: 'after' },
    );

    if (!updatedActivation) {
      await this.recordIgnoredResult(envelope);
      return;
    }

    this.logger.log(
      `Resultado de ${service} registrado: ${status} (activación=${envelope.correlationId}, eventType=${envelope.eventType})`,
    );

    if (status === 'FAILED') {
      await this.failActivation(
        updatedActivation._id,
        service,
        failureReason ?? 'unknown',
      );
      return;
    }

    await this.completeActivationIfReady(updatedActivation._id);
  }

  private async recordIgnoredResult(
    envelope: Envelope<unknown>,
  ): Promise<void> {
    const result = await this.activationModel.updateOne(
      { _id: envelope.correlationId },
      {
        $push: {
          history: {
            eventType: envelope.eventType,
            at: new Date(),
          },
        },
      },
    );

    if (result.matchedCount === 0) {
      this.logger.warn(
        `Evento ${envelope.eventType} ignorado: no existe la activación ${envelope.correlationId}`,
      );
      return;
    }

    this.logger.log(
      `Evento ${envelope.eventType} registrado solo en el historial (activación=${envelope.correlationId}, estado final)`,
    );
  }

  private async completeActivationIfReady(activationId: string): Promise<void> {
    const at = new Date();
    const completedActivation = await this.activationModel.findOneAndUpdate(
      {
        _id: activationId,
        status: 'IN_PROGRESS',
        'steps.billing.status': 'OK',
        'steps.provisioning.status': 'OK',
      },
      {
        $set: { status: 'ACTIVE' },
        $push: {
          history: {
            eventType: 'ActivationCompleted',
            at,
          },
        },
      },
      { returnDocument: 'after' },
    );

    if (!completedActivation) return;

    this.logger.log(
      `Activación ${completedActivation._id} -> ACTIVE (billing y provisioning OK)`,
    );

    this.publishActivationResult(completedActivation, 'ActivationCompleted', {
      planId: completedActivation.planId,
    });
  }

  private async failActivation(
    activationId: string,
    failedService: 'billing' | 'provisioning',
    reason: string,
  ): Promise<void> {
    const at = new Date();
    const failedActivation = await this.activationModel.findOneAndUpdate(
      { _id: activationId, status: 'IN_PROGRESS' },
      {
        $set: { status: 'FAILED' },
        $push: {
          history: {
            eventType: 'ActivationFailed',
            at,
          },
        },
      },
      { returnDocument: 'after' },
    );

    if (!failedActivation) return;

    this.logger.warn(
      `Activación ${failedActivation._id} -> FAILED (falló ${failedService}: ${reason})`,
    );

    this.publishActivationResult(failedActivation, 'ActivationFailed', {
      failedService,
      reason,
    });
  }

  private publishActivationResult(
    activation: ActivationDocument,
    eventType: 'ActivationCompleted' | 'ActivationFailed',
    payload: ActivationResultPayload,
  ): void {
    const envelope = createEnvelope<ActivationResultPayload>({
      correlationId: activation._id,
      customerId: activation.customerId,
      eventType,
      source: 'activation-api',
      payload,
    });

    this.publish(TOPICS.activationEvents, envelope);
  }
}
