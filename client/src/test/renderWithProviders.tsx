import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext, type AuthContextValue } from '../contexts/authContext';
import { LangProvider } from '../contexts/LangProvider';
import type { User } from '../types/api';

interface Options {
  path?: string;
  route?: string;
  user?: User | null;
  auth?: Partial<AuthContextValue>;
  extraRoutes?: ReactElement[];
}

export function renderWithProviders(ui: ReactElement, { path = '/', route = '/', user = null, auth = {}, extraRoutes = [] }: Options = {}) {
  const value: AuthContextValue = {
    user,
    login: vi.fn(),
    logout: vi.fn(),
    ...auth,
  };
  return render(
    <LangProvider>
      <AuthContext.Provider value={value}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={ui} />
            {extraRoutes}
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </LangProvider>,
  );
}

export const adminUser: User = {
  id: 1,
  name: 'Admin',
  role: 'admin',
  collective: { id: 1, name: 'Collectif', slug: 'c', color: '#000000' },
};
