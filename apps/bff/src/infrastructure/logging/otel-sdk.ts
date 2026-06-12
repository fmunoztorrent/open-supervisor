import { NodeSDK, core, node } from '@opentelemetry/sdk-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { propagation } from '@opentelemetry/api';

export interface OtelConfig {
  serviceName?: string;
  exporterEndpoint?: string;
}

let sdkInstance: NodeSDK | null = null;
let initialized = false;

export function initOtel(config?: OtelConfig): () => void {
  if (initialized && sdkInstance) {
    return () => shutdownOtel();
  }

  const serviceName =
    config?.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'bff';
  const exporterEndpoint =
    config?.exporterEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  propagation.setGlobalPropagator(new core.W3CTraceContextPropagator());

  const traceExporter = exporterEndpoint
    ? new OTLPTraceExporter({
        url: `${exporterEndpoint.replace(/\/+$/, '')}/v1/traces`,
      })
    : new node.ConsoleSpanExporter();

  sdkInstance = new NodeSDK({
    serviceName,
    traceExporter,
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
    ],
  });

  sdkInstance.start();
  initialized = true;

  return () => shutdownOtel();
}

function shutdownOtel(): void {
  if (sdkInstance) {
    sdkInstance.shutdown().catch((err: unknown) => {
      console.warn('Error shutting down OTel SDK:', err);
    });
    sdkInstance = null;
    initialized = false;
  }
}

// Auto-initialize when imported as side-effect module
initOtel();
