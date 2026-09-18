import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Loading } from '../components/common/Feedback';
import { AdminLayout } from '../components/layout/AdminLayout';
import { PublicLayout } from '../components/layout/PublicLayout';
import EventPage from '../pages/public/EventPage';
import EventsListPage from '../pages/public/EventsListPage';
import LoginPage from '../pages/public/LoginPage';
import NotFoundPage from '../pages/public/NotFoundPage';
import OrderPage from '../pages/public/OrderPage';
import type { Role } from '../types/api';
import { RequireRole } from './RequireRole';

// Pages organisateur et contrôle chargées à la demande : le public ne télécharge pas leur code.
const AdminEventsPage = lazy(() => import('../pages/admin/AdminEventsPage'));
const AdminEventPage = lazy(() => import('../pages/admin/AdminEventPage'));
const NewEventPage = lazy(() => import('../pages/admin/NewEventPage'));
const EditEventPage = lazy(() => import('../pages/admin/EditEventPage'));
const TransfersPage = lazy(() => import('../pages/admin/TransfersPage'));
const TeamPage = lazy(() => import('../pages/admin/TeamPage'));
const PlatformPage = lazy(() => import('../pages/admin/PlatformPage'));
const ScanHomePage = lazy(() => import('../pages/scan/ScanHomePage'));
const ScannerPage = lazy(() => import('../pages/scan/ScannerPage'));
const MockPaymentPage = lazy(() => import('../pages/public/MockPaymentPage'));
// Outil de démo : absent du build de production (import.meta.env.DEV est remplacé par false).
const MailboxPage = import.meta.env.DEV ? lazy(() => import('../pages/dev/MailboxPage')) : null;

const ADMIN: Role[] = ['admin'];
const SUPERADMIN: Role[] = ['superadmin'];
const STAFF: Role[] = ['admin', 'controller'];

const guarded = (roles: Role[], page: ReactNode) => <RequireRole roles={roles}>{page}</RequireRole>;

export function AppRoutes() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<EventsListPage />} />
          <Route path="c/:slug" element={<EventsListPage />} />
          <Route path="evenements/:id" element={<EventPage />} />
          <Route path="commande/:token" element={<OrderPage />} />
          <Route path="connexion" element={<LoginPage />} />
          {MailboxPage && <Route path="dev/mails" element={<MailboxPage />} />}
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        <Route path="paiement-simule/:sessionId" element={<MockPaymentPage />} />

        <Route path="admin" element={guarded(ADMIN, <AdminLayout />)}>
          <Route index element={<AdminEventsPage />} />
          <Route path="evenements/nouveau" element={<NewEventPage />} />
          <Route path="evenements/:id" element={<AdminEventPage />} />
          <Route path="evenements/:id/modifier" element={<EditEventPage />} />
          <Route path="virements" element={<TransfersPage />} />
          <Route path="equipe" element={<TeamPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        <Route path="plateforme" element={guarded(SUPERADMIN, <AdminLayout />)}>
          <Route index element={<PlatformPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        <Route path="controle" element={guarded(STAFF, <ScanHomePage />)} />
        <Route path="controle/:eventId" element={guarded(STAFF, <ScannerPage />)} />
      </Routes>
    </Suspense>
  );
}
