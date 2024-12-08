import { lazy } from 'solid-js';
import type { RouteDefinition } from '@solidjs/router';

import ZonesPage from './pages/zones';

export const routes: RouteDefinition[] = [
  {
    path: '/',
    component: ZonesPage,
  },
  {
    path: '**',
    component: lazy(() => import('./errors/404')),
  },
];
