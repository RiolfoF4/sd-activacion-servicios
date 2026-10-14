export const EVENT_TYPES = [
  "ActivationRequested",
  "BillingAccountCreated",
  "BillingFailed",
  "BillingAccountCancelled",
  "ProvisioningCompleted",
  "ProvisioningFailed",
  "ActivationCompleted",
  "ActivationFailed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
