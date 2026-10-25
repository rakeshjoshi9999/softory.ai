import { firstValueFrom } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

// Shared test support lives in orders-service; loaded by computed path to respect module boundaries.
type Support = typeof import('../../../orders-service/test-support/live-service');
type LiveOrders = Awaited<ReturnType<Support['startOrdersService']>>;
const { breakingSpec, startOrdersService } = (await import(
  /* @vite-ignore */ fileURLToPath(new URL('../../../orders-service/test-support/live-service.ts', import.meta.url))
)) as Support;

/** Live contract: orders-admin-ui calls a running orders-service through the emitted client over real HTTP. */
const draft = { customerId: 'c-1', currency: 'EUR', lines: [{ sku: 'sku-1', quantity: 2, unitPrice: 500 }] };

describe('orders-admin-ui <-> orders-service over HTTP', () => {
  let live: LiveOrders;
  let drifted: LiveOrders;
  beforeAll(async () => {
    live = await startOrdersService();
    drifted = await startOrdersService({ servedSpec: breakingSpec() });
  });
  afterAll(async () => {
    await live.close();
    await drifted.close();
  });

  it('lists and opens an order', async () => {
    const created = await firstValueFrom(live.client.createOrder(draft));
    const page = await firstValueFrom(live.client.listOrders({ limit: 10 }));
    expect(page.items?.map((o) => o.id)).toContain(created.id);
    expect(await firstValueFrom(live.client.getOrder(created.id as string))).toEqual(created);
  });

  it('fails against a service that removed getOrder (breaking change)', async () => {
    await expect(firstValueFrom(drifted.client.getOrder('1'))).rejects.toMatchObject({ status: 404 });
  });
});
