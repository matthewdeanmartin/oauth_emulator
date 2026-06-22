import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home.component';
import { LoginComponent } from './pages/login.component';
import { ProtectedComponent } from './pages/protected.component';
import { CallbackComponent } from './pages/callback.component';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'login', component: LoginComponent },
  { path: 'callback', component: CallbackComponent },
  { path: 'protected', component: ProtectedComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
