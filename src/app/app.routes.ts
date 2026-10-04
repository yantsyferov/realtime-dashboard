import type { Routes } from '@angular/router';
import { Dashboard } from './pages/dashboard/dashboard.component';
import { Settings } from './pages/settings/settings.component';

export const routes: Routes = [
  { path: '', component: Dashboard, pathMatch: 'full' },
  { path: 'settings', component: Settings },
];
