import { Controller, Logger } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
} from '@nestjs/microservices';
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
  private readonly logger = new Logger(ActivationsConsumer.name);

  constructor(private readonly activationsService: ActivationsService) {}

  @EventPattern(TOPICS.billingEvents)
  async onBillingResult(
    @Payload() envelope: Envelope<BillingResultPayload>,
    @Ctx() rawContext: unknown,
  ): Promise<void> {
    this.logReceived(envelope, rawContext);
    await this.activationsService.handleBillingResult(envelope);
  }

  @EventPattern(TOPICS.provisioningEvents)
  async onProvisioningResult(
    @Payload() envelope: Envelope<ProvisioningResultPayload>,
    @Ctx() rawContext: unknown,
  ): Promise<void> {
    this.logReceived(envelope, rawContext);
    await this.activationsService.handleProvisioningResult(envelope);
  }

  private logReceived(
    envelope: Envelope<unknown>,
    rawContext: unknown,
  ): void {
    // Nest 12 tipa @EventPattern y exige que los parámetros extra del handler
    // sean "unknown"; el contexto real sigue siendo un KafkaContext.
    const context = rawContext as KafkaContext;
    const message = context.getMessage();
    const key = message.key?.toString() ?? 'sin key';

    this.logger.log(
      `${envelope.eventType} recibido (activación=${envelope.correlationId}, eventId=${envelope.eventId}, key=${key}, partition=${context.getPartition()}, offset=${message.offset})`,
    );
  }
}
