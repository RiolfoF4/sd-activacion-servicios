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
    // Nest 12 tipa @EventPattern y exige que los parámetros extra del handler
    // sean "unknown"; el contexto real sigue siendo un KafkaContext.
    const context = rawContext as KafkaContext;
    const message = context.getMessage();
    const key = message.key?.toString() ?? 'sin key';

    this.logger.log(
      `${envelope.eventType} recibido (activación=${envelope.correlationId}, eventId=${envelope.eventId}, key=${key}, partition=${context.getPartition()}, offset=${message.offset})`,
    );

    await this.billingService.handleActivationRequested(envelope);
  }
}
