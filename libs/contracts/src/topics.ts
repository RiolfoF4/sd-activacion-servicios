export const TOPICS = {
  activationRequested: "activation.requested",
  billingEvents: "billing.events",
  provisioningEvents: "provisioning.events",
  activationEvents: "activation.events",
} as const;
export type Topic = (typeof TOPICS)[keyof typeof TOPICS];
export const dlq = (t: Topic) => `${t}.dlq`;
