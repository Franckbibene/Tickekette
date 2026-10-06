import { createContext } from 'react';
import type { MfaChallenge, MfaSetup, User } from '../types/api';

export interface AuthContextValue {
  user: User | null;
  login: (email: string, password: string, otp?: string) => Promise<User | MfaChallenge>;
  mfaSetup: () => Promise<MfaSetup>;
  confirmMfa: (otp: string) => Promise<User>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
