import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RequireRole } from './auth.jsx';
import { AdminLayout, PublicLayout } from './components/Layouts.jsx';
import EventsList from './pages/public/EventsList.jsx';
import EventPage from './pages/public/EventPage.jsx';
import OrderPage from './pages/public/OrderPage.jsx';
import MockPay from './pages/public/MockPay.jsx';
import Login from './pages/public/Login.jsx';
import NotFound from './pages/public/NotFound.jsx';
import AdminEvents from './pages/admin/AdminEvents.jsx';
import EventForm from './pages/admin/EventForm.jsx';
import AdminEventDetail from './pages/admin/AdminEventDetail.jsx';
import Transfers from './pages/admin/Transfers.jsx';
import Team from './pages/admin/Team.jsx';
import Platform from './pages/admin/Platform.jsx';
import ScanHome from './pages/scan/ScanHome.jsx';
import Mailbox from './pages/dev/Mailbox.jsx';

// La caméra (html5-qrcode) est lourde : l'écran de contrôle n'est chargé que lorsqu'on l'ouvre.
const Scanner = lazy(() => import('./pages/scan/Scanner.jsx'));

const STAFF = ['admin', 'controller'];

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<EventsList />} />
        <Route path="c/:slug" element={<EventsList />} />
        <Route path="evenements/:id" element={<EventPage />} />
        <Route path="commande/:token" element={<OrderPage />} />
        <Route path="connexion" element={<Login />} />
        <Route path="dev/mails" element={<Mailbox />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="paiement-simule/:sessionId" element={<MockPay />} />

      <Route
        path="admin"
        element={
          <RequireRole roles={['admin']}>
            <AdminLayout />
          </RequireRole>
        }
      >
        <Route index element={<AdminEvents />} />
        <Route path="evenements/nouveau" element={<EventForm />} />
        <Route path="evenements/:id" element={<AdminEventDetail />} />
        <Route path="evenements/:id/modifier" element={<EventForm />} />
        <Route path="virements" element={<Transfers />} />
        <Route path="equipe" element={<Team />} />
      </Route>

      <Route
        path="plateforme"
        element={
          <RequireRole roles={['superadmin']}>
            <AdminLayout />
          </RequireRole>
        }
      >
        <Route index element={<Platform />} />
      </Route>

      <Route
        path="controle"
        element={
          <RequireRole roles={STAFF}>
            <ScanHome />
          </RequireRole>
        }
      />
      <Route
        path="controle/:eventId"
        element={
          <RequireRole roles={STAFF}>
            <Suspense fallback={<div className="scanner" />}>
              <Scanner />
            </Suspense>
          </RequireRole>
        }
      />
    </Routes>
  );
}
