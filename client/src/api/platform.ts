import type { CollectiveInput, PlatformCollective } from '../types/api';
import { expectArray, expectObject, request } from './http';

export const platformApi = {
  collectives: (signal?: AbortSignal) => request<PlatformCollective[]>('/platform/collectives', { signal }).then(expectArray),
  createCollective: (input: CollectiveInput) =>
    request<PlatformCollective>('/platform/collectives', { method: 'POST', body: input }).then((c) => expectObject(c, ['id', 'name'])),
};
