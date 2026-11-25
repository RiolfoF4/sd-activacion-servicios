import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const BILLING_ACCOUNT_STATUSES = ['CREATED', 'CANCELLED'] as const;
export type BillingAccountStatus = (typeof BILLING_ACCOUNT_STATUSES)[number];

@Schema({ collection: 'billing_accounts', timestamps: true, versionKey: false })
export class BillingAccount {
  // Una cuenta por activación
  @Prop({ required: true, unique: true })
  activationId: string;

  @Prop({ required: true })
  billingAccountId: string;

  @Prop({ required: true, index: true })
  customerId: string;

  @Prop({ required: true })
  planId: string;

  @Prop({
    type: String,
    enum: [...BILLING_ACCOUNT_STATUSES],
    default: 'CREATED',
  })
  status: BillingAccountStatus;

  // Se completan al compensar una activación fallida. Un documento CANCELLED
  // puede ser un tombstone: la cuenta nunca llegó a crearse y solo marca que
  // un ActivationRequested tardío no debe crearla.
  @Prop()
  cancelledAt?: Date;

  @Prop()
  cancellationReason?: string;
}

export const BillingAccountSchema =
  SchemaFactory.createForClass(BillingAccount);
export type BillingAccountDocument = HydratedDocument<BillingAccount>;
