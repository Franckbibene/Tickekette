import type { User } from '../types/api';
import { expectObject, request } from './http';

export const authApi = {
  login: (email: string, password: string) =>
    request<User>('/auth/login', { method: 'POST', body: { email, password } }).then((u) => expectObject(u, ['id', 'role'])),
  logout: () => request<undefined>('/auth/logout', { method: 'POST' }),
  me: (signal?: AbortSignal) => request<User>('/auth/me', { signal }).then((u) => expectObject(u, ['id', 'role'])),
};
