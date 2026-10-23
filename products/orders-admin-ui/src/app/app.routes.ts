import type { Routes } from '@angular/router';
import { remoteRoutes } from './remote.routes';

/** Standalone (local dev) routes: the same routes the shell mounts. */
export const routes: Routes = remoteRoutes;
