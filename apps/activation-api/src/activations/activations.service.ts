import { Model } from 'mongoose';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Activation, ActivationDocument } from './activations.schema';
import { CreateActivationDto } from './dto/create-activation.dto';
import { randomUUID } from 'crypto';
import { ClientKafka } from '@nestjs/microservices';
import {
  ActivationRequestedPayload,
  TOPICS,
  createEnvelope,
} from '@poc/contracts';
import { KAFKA_CLIENT } from './kafka/kafka-producer.module';

@Injectable()
export class ActivationsService {
  constructor(
    @InjectModel(Activation.name) private activationModel: Model<Activation>,

    @Inject(KAFKA_CLIENT)
    private readonly client: ClientKafka,
  ) {}

  private publishActivationRequested(activation: ActivationDocument) {
    const envelope = createEnvelope<ActivationRequestedPayload>({
      correlationId: activation._id,
      customerId: activation.customerId,
      eventType: 'ActivationRequested',
      source: 'activation-api',
      version: 1,
      payload: {
        channel: 'web',
        planId: activation.planId,
        simulateFailure: activation.simulateFailure,
      },
    });

    this.client.emit(TOPICS.activationRequested, {
      key: envelope.customerId,
      value: envelope,
    });
  }

  private newActivationId(): string {
    const len = 6;
    return `act-${randomUUID().replace(/-/g, '').slice(0, len)}`;
  }

  async create(
    createActivationDto: CreateActivationDto,
  ): Promise<ActivationDocument> {
    const { customerId, planId, simulateFailure } = createActivationDto;
    const createdActivation = new this.activationModel({
      _id: this.newActivationId(),
      customerId,
      planId,
      simulateFailure,
    });

    const savedActivation = await createdActivation.save();

    this.publishActivationRequested(savedActivation);

    return savedActivation;
  }

  async findById(id: string): Promise<ActivationDocument | null> {
    return this.activationModel.findById(id).exec();
  }
}
