import type { EventType } from "./event-type";

export type Envelope<T> = {
  eventId: string;
  eventType: EventType;
  version: number;
  occurredAt: string;
  correlationId: string;
  customerId: string;
  source: string;
  payload: T;
};
