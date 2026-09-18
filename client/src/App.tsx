import { useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AuthProvider } from './contexts/AuthProvider';
import { LangProvider } from './contexts/LangProvider';
import { AppRoutes } from './routes/AppRoutes';

export default function App() {
  const { pathname } = useLocation();
  return (
    <LangProvider>
      <AuthProvider>
        <ErrorBoundary resetKey={pathname}>
          <AppRoutes />
        </ErrorBoundary>
      </AuthProvider>
    </LangProvider>
  );
}
