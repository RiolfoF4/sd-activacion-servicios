import { Controller, Logger } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
} from '@nestjs/microservices';
import {
  TOPICS,
  type ActivationCompletedPayload,
  type ActivationFailedPayload,
  type Envelope,
} from '@poc/contracts';
import { NotificationService } from './notification.service';

type ActivationResultPayload =
  ActivationCompletedPayload | ActivationFailedPayload;

@Controller()
export class NotificationConsumer {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(private readonly notificationService: NotificationService) {}

  @EventPattern(TOPICS.activationEvents)
  async onActivationResult(
    @Payload() envelope: Envelope<ActivationResultPayload>,
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

    await this.notificationService.handleActivationResult(envelope);
  }
}
