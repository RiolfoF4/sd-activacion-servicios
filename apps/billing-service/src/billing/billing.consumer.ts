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
  type ActivationRequestedPayload,
  type Envelope,
} from '@poc/contracts';
import { BillingService } from './billing.service';

type ActivationResultPayload =
  | ActivationCompletedPayload
  | ActivationFailedPayload;

@Controller()
export class BillingConsumer {
  private readonly logger = new Logger(BillingConsumer.name);

  constructor(private readonly billingService: BillingService) {}

  @EventPattern(TOPICS.activationRequested)
  async onActivationRequested(
    @Payload() envelope: Envelope<ActivationRequestedPayload>,
    @Ctx() rawContext: unknown,
  ): Promise<void> {
    this.logReceived(envelope, rawContext);
    await this.billingService.handleActivationRequested(envelope);
  }

  @EventPattern(TOPICS.activationEvents)
  async onActivationResult(
    @Payload() envelope: Envelope<ActivationResultPayload>,
    @Ctx() rawContext: unknown,
  ): Promise<void> {
    this.logReceived(envelope, rawContext);

    if (envelope.eventType !== 'ActivationFailed') {
      this.logger.log(
        `Evento ${envelope.eventType} ignorado por billing (activación=${envelope.correlationId})`,
      );
      return;
    }

    // El evento es ActivationFailed, así que el payload es el de esa variante.
    await this.billingService.handleActivationFailed(
      envelope as Envelope<ActivationFailedPayload>,
    );
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
