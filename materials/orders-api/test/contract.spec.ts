import 'reflect-metadata';
import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Controller, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HttpErrorResponse, provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { createEnvironmentInjector, EnvironmentInjector, platformCore, provideZonelessChangeDetection, runInInjectionContext, ɵINJECTOR_SCOPE } from '@angular/core';
import { Ajv } from 'ajv';
import { firstValueFrom } from 'rxjs';
import { parse } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrdersService } from '../generated/angular-client/orders/orders.service';
import type { Order } from '../generated/angular-client/models';
import { OrdersControllerBase } from '../generated/nest-server/controllers/orders.controller.base';

/**
 * Contract test: the generated Angular client talks to a NestJS service built on the generated
 * controller base over real HTTP, and every body that crosses the wire must satisfy the
 * schemas in generated/openapi.yaml. If either emitted side drifts from the spec, this fails.
 */
const spec = parse(readFileSync(fileURLToPath(new URL('../generated/openapi.yaml', import.meta.url)), 'utf8'));
const ajv = new Ajv({ strict: false, validateFormats: false });
ajv.addSchema({ ...spec, $id: 'spec' });
const conforms = (schema: string, value: unknown) => {
  const validate = ajv.getSchema(`spec#/components/schemas/${schema}`);
  if (!validate) throw new Error(`spec has no schema ${schema}`);
  return validate(value) ? [] : (validate.errors ?? []);
};

// Request bodies omit readOnly (server-assigned) properties, so those are not required there.
const writable = (schema: string) => {
  const s = spec.components.schemas[schema];
  const readOnly = Object.entries<{ readOnly?: boolean }>(s.properties).filter(([, p]) => p.readOnly).map(([k]) => k);
  return { ...s, required: s.required.filter((k: string) => !readOnly.includes(k)) };
};
const conformsToRequest = (schema: string, value: unknown) => {
  const validate = ajv.compile({ ...spec, ...writable(schema), $id: undefined });
  return validate(value) ? [] : (validate.errors ?? []);
};

const wire: { method: string; url: string; body: unknown }[] = [];

// The service implements only the abstract operations; routing comes from the generated base.
@Controller()
class OrdersController extends OrdersControllerBase {
  private readonly store = new Map<string, Order>();
  listOrders() {
    return { items: [...this.store.values()] };
  }
  createOrder(body: Order) {
    const order: Order = { ...body, id: String(this.store.size + 1), status: 'pending', createdAt: new Date().toISOString() };
    this.store.set(order.id as string, order);
    return order;
  }
  getOrder(id: string) {
    const order = this.store.get(id);
    if (!order) throw new NotFoundException({ code: 'order_not_found', message: `no order ${id}` });
    return order;
  }
}

const draft = { customerId: 'c-1', currency: 'EUR', lines: [{ sku: 'sku-1', quantity: 2, unitPrice: 500 }] };

describe('contract: generated Angular client <-> generated NestJS controller', () => {
  let app: INestApplication;
  let client: OrdersService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [OrdersController] }).compile();
    app = mod.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const injector = createEnvironmentInjector(
      [
        // A bare environment injector has no root scope, so providedIn: 'root' services (HttpClient deps) would not resolve.
        { provide: ɵINJECTOR_SCOPE, useValue: 'root' },
        provideZonelessChangeDetection(),
        provideHttpClient(
          withFetch(),
          withInterceptors([
            (req, next) => {
              wire.push({ method: req.method, url: req.url, body: req.body });
              return next(req.clone({ url: base + req.url }));
            },
          ]),
        ),
      ],
      platformCore().injector as EnvironmentInjector,
    );
    client = runInInjectionContext(injector, () => new OrdersService());
  });
  afterAll(() => app.close());

  it('creates, fetches and lists an order, and every body matches the spec', async () => {
    expect(conformsToRequest('Order', draft)).toEqual([]);
    const created = await firstValueFrom(client.createOrder(draft));
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('pending');
    expect(conforms('Order', created)).toEqual([]);

    const fetched = await firstValueFrom(client.getOrder(created.id as string));
    expect(fetched).toEqual(created);

    const page = await firstValueFrom(client.listOrders({ limit: 10 }));
    expect(page.items).toEqual([created]);
    expect(conforms('OrderPage', page)).toEqual([]);
    expect(wire.map((w) => `${w.method} ${w.url.split('?')[0]}`)).toEqual(['POST /orders', 'GET /orders/1', 'GET /orders']);
  });

  it('surfaces the spec-defined 404 Problem body', async () => {
    const err = await firstValueFrom(client.getOrder('missing')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpErrorResponse);
    const e = err as HttpErrorResponse;
    expect(e.status).toBe(404);
    expect(conforms('Problem', { code: e.error.code, message: e.error.message })).toEqual([]);
  });

  it('catches drift: bodies that break the spec are rejected by the checker', () => {
    const drifted: Partial<typeof draft> = { ...draft };
    delete drifted.currency;
    expect(conformsToRequest('Order', drifted).length).toBeGreaterThan(0);
    expect(conforms('OrderPage', { items: [{ ...draft, id: '1' }] }).length).toBeGreaterThan(0);
  });
});
