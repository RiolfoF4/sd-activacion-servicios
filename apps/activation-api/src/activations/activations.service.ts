import { Model } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Activation, ActivationDocument } from './activations.schema';
import { CreateActivationDto } from './dto/create-activation.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class ActivationsService {
  constructor(
    @InjectModel(Activation.name) private activationModel: Model<Activation>,
  ) {}

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

    return createdActivation.save();
  }

  async findById(id: string): Promise<ActivationDocument | null> {
    return this.activationModel.findById(id).exec();
  }
}
