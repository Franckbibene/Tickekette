import type { MfaChallenge, MfaSetup, User } from '../types/api';
import { expectObject, request } from './http';

export const authApi = {
  login: (email: string, password: string, otp?: string) =>
    request<User | MfaChallenge>('/auth/login', { method: 'POST', body: { email, password, ...(otp ? { otp } : {}) } }).then((result) =>
      'mfaRequired' in result ? expectObject(result, ['mfaRequired', 'setupRequired']) : expectObject(result, ['id', 'role']),
    ),
  mfaSetup: () => request<MfaSetup>('/auth/mfa/setup').then((setup) => expectObject(setup, ['secret', 'uri'])),
  confirmMfa: (otp: string) =>
    request<User>('/auth/mfa/confirm', { method: 'POST', body: { otp } }).then((u) => expectObject(u, ['id', 'role'])),
  logout: () => request<undefined>('/auth/logout', { method: 'POST' }),
  me: (signal?: AbortSignal) => request<User>('/auth/me', { signal }).then((u) => expectObject(u, ['id', 'role'])),
};
