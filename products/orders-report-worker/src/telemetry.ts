import type { Config } from './config/config';

/** Starts OpenTelemetry tracing. Exports over OTLP/HTTP only when OTEL_EXPORTER_OTLP_ENDPOINT is set. */
export async function startTelemetry(config: Config): Promise<void> {
  if (config.otlpEndpoint === undefined) {
    return;
  }
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const sdk = new NodeSDK({
    serviceName: config.serviceName,
    traceExporter: new OTLPTraceExporter({ url: `${config.otlpEndpoint}/v1/traces` }),
  });
  sdk.start();
  process.once('SIGTERM', () => void sdk.shutdown());
}
