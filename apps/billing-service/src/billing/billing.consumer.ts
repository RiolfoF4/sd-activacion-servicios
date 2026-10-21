import { Controller, Logger } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
} from '@nestjs/microservices';
import {
  TOPICS,
  type ActivationRequestedPayload,
  type Envelope,
} from '@poc/contracts';
import { BillingService } from './billing.service';

@Controller()
export class BillingConsumer {
  private readonly logger = new Logger(BillingConsumer.name);

  constructor(private readonly billingService: BillingService) {}

  @EventPattern(TOPICS.activationRequested)
  async onActivationRequested(
    @Payload() envelope: Envelope<ActivationRequestedPayload>,
    @Ctx() rawContext: unknown,
  ): Promise<void> {
    const context = rawContext as KafkaContext;
    const message = context.getMessage();
    const key = message.key?.toString() ?? 'sin key';

    this.logger.log(
      `ActivationRequested recibido (activación=${envelope.correlationId}, key=${key}, partition=${context.getPartition()}, offset=${message.offset})`,
    );

    await this.billingService.handleActivationRequested(envelope);
  }
}
