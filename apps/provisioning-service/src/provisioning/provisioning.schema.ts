import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const PROVISIONING_ORDER_STATUSES = ['COMPLETED'] as const;
export type ProvisioningOrderStatus =
  (typeof PROVISIONING_ORDER_STATUSES)[number];

@Schema({
  collection: 'provisioning_orders',
  timestamps: true,
  versionKey: false,
})
export class ProvisioningOrder {
  // Una orden por activación
  @Prop({ required: true, unique: true })
  activationId: string;

  @Prop({ required: true })
  provisioningOrderId: string;

  @Prop({ required: true, index: true })
  customerId: string;

  @Prop({ required: true })
  planId: string;

  @Prop({
    type: String,
    enum: [...PROVISIONING_ORDER_STATUSES],
    default: 'COMPLETED',
  })
  status: ProvisioningOrderStatus;
}

export const ProvisioningOrderSchema =
  SchemaFactory.createForClass(ProvisioningOrder);
export type ProvisioningOrderDocument = HydratedDocument<ProvisioningOrder>;
