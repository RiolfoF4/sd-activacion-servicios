import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { EventType } from '@poc/contracts';

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

@Schema({ collection: 'notifications', timestamps: true, versionKey: false })
export class Notification {
  // Una notificación por activación y tipo de evento
  @Prop({ required: true })
  activationId: string;

  @Prop({ type: String, required: true })
  eventType: EventType;

  @Prop({ required: true, index: true })
  customerId: string;

  @Prop({ required: true })
  recipient: string;

  @Prop({ required: true })
  subject: string;

  @Prop({
    type: String,
    enum: [...NOTIFICATION_STATUSES],
    default: 'PENDING',
  })
  status: NotificationStatus;

  @Prop()
  messageId?: string;

  @Prop()
  error?: string;

  @Prop()
  sentAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// La clave de la idempotencia: si Kafka reentrega el evento, el segundo insert
// choca contra este índice y no se manda un email duplicado.
NotificationSchema.index({ activationId: 1, eventType: 1 }, { unique: true });

export type NotificationDocument = HydratedDocument<Notification>;
