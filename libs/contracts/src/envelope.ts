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

export type EnvelopeInput<T> = Omit<
  Envelope<T>,
  "eventId" | "version" | "occurredAt"
> & { version?: number };

export function createEnvelope<T>(input: EnvelopeInput<T>): Envelope<T> {
  return {
    ...input,
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    version: input.version ?? 1,
  };
}
