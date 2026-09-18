import { ApiError, UNAUTHORIZED_EVENT, request } from './http';

function mockFetch(response: Response | Error) {
  const fn = vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client HTTP', () => {
  it('envoie l’en-tête anti-CSRF et le cookie de même origine, jamais de jeton', async () => {
    const fetchMock = mockFetch(json(200, { ok: true }));
    await request('/admin/events', { method: 'POST', body: { a: 1 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('/api/admin/events');
    expect(headers['X-Requested-With']).toBe('tickekette');
    expect(headers).not.toHaveProperty('Authorization');
    expect(init.credentials).toBe('same-origin');
  });

  it('erreur API : message métier du serveur affiché, code conservé', async () => {
    mockFetch(json(409, { error: 'sold_out', message: 'Plus assez de places.' }));
    await expect(request('/x')).rejects.toMatchObject({ status: 409, code: 'sold_out', message: 'Plus assez de places.' });
  });

  it('erreur sans message exploitable : message générique, jamais de détail technique', async () => {
    mockFetch(new Response('<html>Internal Server Error: SQLITE_BUSY</html>', { status: 500 }));
    const err = await request('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).not.toMatch(/SQLITE|html/i);
  });

  it('réponse 200 qui n’est pas du JSON : considérée comme invalide', async () => {
    mockFetch(new Response('ok', { status: 200 }));
    await expect(request('/x')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('réseau coupé : erreur réseau explicite', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    await expect(request('/x')).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('401 : l’interface est prévenue que la session a expiré', async () => {
    mockFetch(json(401, { error: 'unauthenticated', message: 'Connexion requise.' }));
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    await expect(request('/admin/events')).rejects.toBeInstanceOf(ApiError);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
    expect(listener).toHaveBeenCalledOnce();
  });
});
