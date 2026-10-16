export type ActivationRequestedPayload = {
  planId: string;
  channel: string;
  simulateFailure: SimulateFailure;
};

export const SIMULATE_FAILURE = ["billing", "provisioning", "none"] as const;

export type SimulateFailure = (typeof SIMULATE_FAILURE)[number];
