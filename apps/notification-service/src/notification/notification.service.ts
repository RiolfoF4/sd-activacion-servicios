import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type {
  ActivationCompletedPayload,
  ActivationFailedPayload,
  Envelope,
} from '@poc/contracts';
import { MailService, type EmailContent } from '../mail/mail.service';
import type { NotificationDocument } from './notification.schema';
import { Notification } from './notification.schema';

type ActivationResultPayload =
  ActivationCompletedPayload | ActivationFailedPayload;

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,

    private readonly mailService: MailService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Espera a que Mongoose construya el índice único antes de consumir.
    // Si el primer evento llegara antes, la idempotencia quedaría sin red.
    await this.notificationModel.init();
  }

  async handleActivationResult(
    envelope: Envelope<ActivationResultPayload>,
  ): Promise<void> {
    const { eventType, correlationId } = envelope;

    if (
      eventType !== 'ActivationCompleted' &&
      eventType !== 'ActivationFailed'
    ) {
      this.logger.warn(
        `Evento ${eventType} ignorado (activación=${correlationId})`,
      );
      return;
    }

    const email = this.buildEmail(envelope);

    // 1. Reservar la notificación. Si ya existe, este evento es un duplicado.
    const notification = await this.claim(envelope, email);
    if (!notification) return;

    try {
      // 2. Enviar el email.
      const info = await this.mailService.send(email);

      // 3. Marcar la notificación como enviada.
      await this.notificationModel.updateOne(
        { _id: notification._id },
        {
          $set: {
            status: 'SENT',
            messageId: info.messageId,
            sentAt: new Date(),
          },
        },
      );

      this.logger.log(
        `Notificación ${eventType} enviada (activación=${correlationId}, destinatario=${email.to}, id=${notification._id.toString()})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // No relanzamos: el documento fue reservado y un reintento de Kafka
      // chocaría contra el índice único. El reintento real es de Fase 3.
      await this.notificationModel.updateOne(
        { _id: notification._id },
        { $set: { status: 'FAILED', error: message } },
      );

      this.logger.error(
        `Falló el envío de ${eventType} (activación=${correlationId}, destinatario=${email.to}): ${message}`,
      );
    }
  }

  private async claim(
    envelope: Envelope<ActivationResultPayload>,
    email: EmailContent,
  ): Promise<NotificationDocument | null> {
    try {
      return await this.notificationModel.create({
        activationId: envelope.correlationId,
        eventType: envelope.eventType,
        customerId: envelope.customerId,
        recipient: email.to,
        subject: email.subject,
        status: 'PENDING',
      });
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        this.logger.log(
          `Activación ${envelope.correlationId} ya notificada (${envelope.eventType}), se ignora el evento repetido`,
        );
        return null;
      }
      throw error;
    }
  }

  private isDuplicateKey(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }

  private buildEmail(
    envelope: Envelope<ActivationResultPayload>,
  ): EmailContent {
    const to = `${this.emailLocalPart(envelope.customerId)}@demo.local`;

    if (envelope.eventType === 'ActivationCompleted') {
      const { planId } = envelope.payload as ActivationCompletedPayload;

      return {
        to,
        subject: `Tu servicio está activo (${envelope.correlationId})`,
        text: [
          `Hola ${envelope.customerId},`,
          '',
          `La activación ${envelope.correlationId} del plan ${planId} quedó ACTIVE.`,
          '',
          'POC Activación de Servicios',
        ].join('\n'),
      };
    }

    const { planId, failedService, reason } =
      envelope.payload as ActivationFailedPayload;

    return {
      to,
      subject: `No pudimos activar tu servicio (${envelope.correlationId})`,
      text: [
        `Hola ${envelope.customerId},`,
        '',
        `La activación ${envelope.correlationId} del plan ${planId} falló en ${failedService}.`,
        `Motivo: ${reason}`,
        '',
        'POC Activación de Servicios',
      ].join('\n'),
    };
  }

  // El destinatario es simulado: <customerId>@demo.local. Sanitizamos el
  // local-part porque el customerId puede traer espacios o caracteres raros.
  private emailLocalPart(customerId: string): string {
    const normalized = customerId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '-');

    return normalized.length > 0 ? normalized : 'cliente';
  }
}
