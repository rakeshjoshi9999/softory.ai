import 'reflect-metadata';
import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Controller, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { createEnvironmentInjector, EnvironmentInjector, platformCore, provideZonelessChangeDetection, runInInjectionContext, ɵINJECTOR_SCOPE } from '@angular/core';
import { parse } from 'yaml';
import type { Observable } from 'rxjs';

// Emitted material code is loaded by computed path: products may not import material source
// statically (module boundaries), and in CI there is no registry to install the packages from.
const material = (rel: string) => fileURLToPath(new URL(`../../../materials/orders-api/${rel}`, import.meta.url));
const load = <T>(rel: string) => import(/* @vite-ignore */ material(rel)) as Promise<T>;
type Order = { id?: string; status?: string; createdAt?: string; [k: string]: unknown };
export interface OrdersClient {
  createOrder(body: Order): Observable<Order>;
  getOrder(id: string): Observable<Order>;
  listOrders(params?: { limit?: number }): Observable<{ items?: Order[] }>;
}
const { OrdersService } = await load<{ OrdersService: new () => OrdersClient }>('generated/angular-client/orders/orders.service.ts');
const { OrdersControllerBase } = await load<{ OrdersControllerBase: abstract new () => object }>('generated/nest-server/controllers/orders.controller.base.ts');

/**
 * Shared test support for the live HTTP contract tests of the orders-api consumers.
 * It starts an orders-service (NestJS on the generated controller base) on a random port and
 * hands out the emitted Angular client pointed at it. It is not part of any product build.
 *
 * `servedSpec` makes the service behave like a different version of the contract: any route
 * absent from that spec answers 404, which is what a consumer sees after a breaking removal.
 */
const read = (file: string) => readFileSync(file, 'utf8');
export const currentSpec = () => parse(read(material('generated/openapi.yaml'))) as OpenApi;
export const breakingSpec = () => parse(read(material('test/fixtures/breaking-openapi.yaml'))) as OpenApi;

export interface OpenApi {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, { required: string[]; properties: Record<string, { readOnly?: boolean }> }> };
}

const specRoutes = (spec: OpenApi) =>
  Object.entries(spec.paths).flatMap(([path, ops]) =>
    Object.keys(ops).map((method) => ({ method: method.toUpperCase(), re: new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`) })),
  );

@Controller()
class OrdersController extends (OrdersControllerBase as unknown as new () => object) {
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

export interface LiveOrders {
  client: OrdersClient;
  baseUrl: string;
  close(): Promise<void>;
}

export async function startOrdersService(options: { servedSpec?: OpenApi } = {}): Promise<LiveOrders> {
  const mod = await Test.createTestingModule({ controllers: [OrdersController] }).compile();
  const app: INestApplication = mod.createNestApplication();
  if (options.servedSpec) {
    const routes = specRoutes(options.servedSpec);
    app.use((req: { method: string; path: string }, res: { status(c: number): { json(b: unknown): void } }, next: () => void) => {
      if (routes.some((r) => r.method === req.method && r.re.test(req.path))) return next();
      res.status(404).json({ code: 'not_found', message: 'route removed from the contract' });
    });
  }
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  const injector = createEnvironmentInjector(
    [
      // A bare environment injector has no root scope, so providedIn: 'root' services would not resolve.
      { provide: ɵINJECTOR_SCOPE, useValue: 'root' },
      provideZonelessChangeDetection(),
      provideHttpClient(withFetch(), withInterceptors([(req, next) => next(req.clone({ url: baseUrl + req.url }))])),
    ],
    platformCore().injector as EnvironmentInjector,
  );
  const client = runInInjectionContext(injector, () => new OrdersService());
  return { client, baseUrl, close: () => app.close() };
}
