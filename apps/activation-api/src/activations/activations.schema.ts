import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { SIMULATE_FAILURE } from '@poc/contracts';
import type { EventType, SimulateFailure } from '@poc/contracts';

export const ACTIVATION_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'ACTIVE',
  'FAILED',
] as const;
export type ActivationStatus = (typeof ACTIVATION_STATUSES)[number];

@Schema({ _id: false })
class StepResult {
  @Prop({ type: String })
  status: 'OK' | 'FAILED';
  @Prop()
  at: Date;
}
export const StepResultSchema = SchemaFactory.createForClass(StepResult);

@Schema({ _id: false })
class ActivationSteps {
  @Prop({ type: StepResultSchema })
  billing?: StepResult;

  @Prop({ type: StepResultSchema })
  provisioning?: StepResult;
}
export const ActivationStepsSchema =
  SchemaFactory.createForClass(ActivationSteps);

@Schema({ _id: false })
class HistoryEntry {
  @Prop({ type: String })
  eventType: EventType;
  @Prop()
  at: Date;
}
export const HistoryEntrySchema = SchemaFactory.createForClass(HistoryEntry);

@Schema({ timestamps: true, versionKey: false })
export class Activation {
  @Prop({ type: String })
  _id: string;
  @Prop({ index: true })
  customerId: string;
  @Prop({ type: String })
  planId: string;
  @Prop({ type: String, enum: [...ACTIVATION_STATUSES], default: 'PENDING' })
  status: ActivationStatus;
  @Prop({ type: String, enum: [...SIMULATE_FAILURE], default: 'none' })
  simulateFailure: SimulateFailure;
  @Prop({ type: ActivationStepsSchema, default: {} })
  steps: ActivationSteps;
  @Prop({ type: [HistoryEntrySchema], default: [] })
  history: HistoryEntry[];
}

export const ActivationSchema = SchemaFactory.createForClass(Activation);
export type ActivationDocument = HydratedDocument<Activation>;
