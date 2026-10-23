import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  TOPICS,
  type BillingAccountCreatedPayload,
  type BillingFailedPayload,
  type Envelope,
  type ProvisioningCompletedPayload,
  type ProvisioningFailedPayload,
} from '@poc/contracts';
import { ActivationsService } from './activations.service';

type BillingResultPayload = BillingAccountCreatedPayload | BillingFailedPayload;
type ProvisioningResultPayload =
  | ProvisioningCompletedPayload
  | ProvisioningFailedPayload;

@Controller()
export class ActivationsConsumer {
  constructor(private readonly activationsService: ActivationsService) {}

  @EventPattern(TOPICS.billingEvents)
  async onBillingResult(
    @Payload() envelope: Envelope<BillingResultPayload>,
  ): Promise<void> {
    await this.activationsService.handleBillingResult(envelope);
  }

  @EventPattern(TOPICS.provisioningEvents)
  async onProvisioningResult(
    @Payload() envelope: Envelope<ProvisioningResultPayload>,
  ): Promise<void> {
    await this.activationsService.handleProvisioningResult(envelope);
  }
}
