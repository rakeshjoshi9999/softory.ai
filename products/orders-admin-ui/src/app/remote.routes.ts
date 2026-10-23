import type { Routes } from '@angular/router';
import { extRoutes } from '../ext';

/** Exposed to the shell through Native Federation as './routes'. */
export const remoteRoutes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./home.component').then((m) => m.HomeComponent) },
  { path: 'ext', children: extRoutes },
];
