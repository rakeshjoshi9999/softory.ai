export interface Config {
  port: number;
  serviceName: string;
  otlpEndpoint?: string;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const errors: string[] = [];
  const rawPort = env['PORT'] ?? '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be an integer between 1 and 65535, got "${rawPort}"`);
  }
  const serviceName = env['SERVICE_NAME'] ?? 'orders-service';
  if (serviceName.trim() === '') {
    errors.push('SERVICE_NAME must not be empty');
  }
  const otlpEndpoint = env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (otlpEndpoint !== undefined && !URL.canParse(otlpEndpoint)) {
    errors.push(`OTEL_EXPORTER_OTLP_ENDPOINT must be a URL, got "${otlpEndpoint}"`);
  }
  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  }
  return { port, serviceName, ...(otlpEndpoint !== undefined && { otlpEndpoint }) };
}
