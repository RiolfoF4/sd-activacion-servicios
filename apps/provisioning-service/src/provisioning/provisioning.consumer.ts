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
import { ProvisioningService } from './provisioning.service';

@Controller()
export class ProvisioningConsumer {
  private readonly logger = new Logger(ProvisioningConsumer.name);

  constructor(private readonly provisioningService: ProvisioningService) {}

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

    await this.provisioningService.handleActivationRequested(envelope);
  }
}
