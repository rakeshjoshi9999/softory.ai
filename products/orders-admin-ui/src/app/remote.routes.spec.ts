import { describe, expect, it } from 'vitest';
import { remoteRoutes } from './remote.routes';

describe('remoteRoutes', () => {
  it('has a lazy home route', () => {
    const home = remoteRoutes.find((r) => r.path === '');
    expect(home?.loadComponent).toBeTypeOf('function');
  });

  it('mounts hand-written routes from src/ext under /ext', () => {
    expect(remoteRoutes.some((r) => r.path === 'ext')).toBe(true);
  });
});
