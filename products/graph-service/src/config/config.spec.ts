import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({ port: 3000, serviceName: 'graph-service' });
  });

  it('reads overrides', () => {
    expect(loadConfig({ PORT: '8080', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318' })).toMatchObject({
      port: 8080,
      otlpEndpoint: 'http://otel:4318',
    });
  });

  it('rejects invalid values with every problem listed', () => {
    expect(() => loadConfig({ PORT: 'abc', OTEL_EXPORTER_OTLP_ENDPOINT: 'nope' })).toThrow(/PORT[\s\S]*OTEL_EXPORTER/);
  });
});
