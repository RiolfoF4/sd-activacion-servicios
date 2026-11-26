import type { EventType, SimulateFailure } from '@poc/contracts';
import type {
  ActivationDocument,
  ActivationStatus,
} from './activations.schema';

export interface ActivationStepSnapshot {
  status: 'OK' | 'FAILED';
  at: string;
}

export interface ActivationHistoryEntrySnapshot {
  eventType: EventType;
  at: string;
}

// Estado completo de una activación. Es el MISMO contrato para el GET y para
// el evento de WebSocket, así la UI nunca tiene que dealiar con dos formas
// distintas del mismo dato.
//
// Se manda el snapshot entero y no solo el evento nuevo: el cliente reemplaza
// su estado y no necesita aplicar parches en orden. Las fechas viajan como
// strings ISO.
export interface ActivationSnapshot {
  activationId: string;
  customerId: string;
  planId: string;
  status: ActivationStatus;
  simulateFailure: SimulateFailure;
  steps: {
    billing?: ActivationStepSnapshot;
    provisioning?: ActivationStepSnapshot;
  };
  history: ActivationHistoryEntrySnapshot[];
  updatedAt: string;
}

// Mongoose agrega createdAt/updatedAt por la option timestamps:true, pero no
// los declara en la clase del schema, así que el tipo del documento los
// "esconde" y hay que volver a declararlos para poder leerlos.
type ActivationWithTimestamps = ActivationDocument & {
  createdAt: Date;
  updatedAt: Date;
};

export function toActivationSnapshot(
  activation: ActivationDocument,
): ActivationSnapshot {
  const document = activation as ActivationWithTimestamps;
  const steps: ActivationSnapshot['steps'] = {};

  if (document.steps?.billing) {
    steps.billing = {
      status: document.steps.billing.status,
      at: document.steps.billing.at.toISOString(),
    };
  }

  if (document.steps?.provisioning) {
    steps.provisioning = {
      status: document.steps.provisioning.status,
      at: document.steps.provisioning.at.toISOString(),
    };
  }

  return {
    activationId: document._id,
    customerId: document.customerId,
    planId: document.planId,
    status: document.status,
    simulateFailure: document.simulateFailure,
    steps,
    history: (document.history ?? []).map((entry) => ({
      eventType: entry.eventType,
      at: entry.at.toISOString(),
    })),
    updatedAt: (document.updatedAt ?? new Date()).toISOString(),
  };
}
