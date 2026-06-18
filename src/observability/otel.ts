import { NodeSDK } from '@opentelemetry/sdk-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    getNodeAutoInstrumentations()
  ]
});

export async function startTelemetry() {
  await sdk.start();
}

