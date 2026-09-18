import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import { eventsApi } from '../../api/events';
import { ApiError } from '../../api/http';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { EventDetail } from '../../types/api';
import EventPage from './EventPage';

vi.mock('../../api/events', () => ({
  eventsApi: { get: vi.fn(), createOrder: vi.fn(), joinWaitlist: vi.fn() },
}));

const event: EventDetail = {
  id: 7,
  title: 'Soirée test',
  description: '',
  venue: 'Salle',
  isOnline: false,
  startsAt: '2030-06-01T19:00:00Z',
  timezone: 'Europe/Paris',
  status: 'published',
  maxPerOrder: 3,
  cancelDeadlineHours: 48,
  transferAllowed: true,
  collective: { name: 'Collectif', slug: 'collectif', color: '#000000' },
  salesOpen: true,
  ticketTypes: [
    {
      id: 1,
      name: 'Fosse',
      priceCents: 2000,
      earlyActive: false,
      earlyPriceCents: null,
      earlyUntil: null,
      earlyRemaining: null,
      available: 2,
      waitlistCount: 0,
    },
    {
      id: 2,
      name: 'VIP',
      priceCents: 5000,
      earlyActive: false,
      earlyPriceCents: null,
      earlyUntil: null,
      earlyRemaining: null,
      available: 0,
      waitlistCount: 1,
    },
  ],
};

function renderEvent(path = '/evenements/7') {
  return renderWithProviders(<EventPage />, {
    path,
    route: '/evenements/:id',
    extraRoutes: [<Route key="order" path="/commande/:token" element={<p>Page commande</p>} />],
  });
}

beforeEach(() => {
  vi.mocked(eventsApi.get).mockResolvedValue(event);
  vi.mocked(eventsApi.createOrder).mockReset();
});

describe('page événement : sélection des places', () => {
  it('impossible de dépasser le stock (2) ni de descendre sous 0', async () => {
    const user = userEvent.setup();
    renderEvent();
    const plus = await screen.findByRole('button', { name: 'Ajouter une place Fosse' });
    const minus = screen.getByRole('button', { name: 'Retirer une place Fosse' });
    expect(minus).toBeDisabled();
    await user.click(plus);
    await user.click(plus);
    expect(plus).toBeDisabled();
    expect(screen.getByText('40,00 €')).toBeInTheDocument();
  });

  it('type complet : pas de sélecteur, inscription à la liste d’attente proposée', async () => {
    renderEvent();
    expect(await screen.findByText('Complet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une place VIP' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Me prévenir/ })).toBeInTheDocument();
  });

  it('identifiant d’URL invalide : page 404 sans appel à l’API', () => {
    renderEvent('/evenements/abc');
    expect(screen.getByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument();
    expect(eventsApi.get).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });
});

describe('page événement : formulaire de réservation', () => {
  async function selectOneSeat() {
    const user = userEvent.setup();
    renderEvent();
    await user.click(await screen.findByRole('button', { name: 'Ajouter une place Fosse' }));
    return user;
  }

  it('champs vides ou invalides : erreurs affichées, rien n’est envoyé', async () => {
    const user = await selectOneSeat();
    await user.type(screen.getByLabelText(/E-mail/), 'pas-un-mail');
    await user.click(screen.getByRole('button', { name: 'Réserver' }));
    expect(screen.getByText('Ce champ est obligatoire.')).toBeInTheDocument();
    expect(screen.getByText('Adresse e-mail invalide.')).toBeInTheDocument();
    expect(eventsApi.createOrder).not.toHaveBeenCalled();
  });

  it('double clic : une seule commande envoyée, avec les données nettoyées (et sans prix)', async () => {
    let resolve: (value: { token: string }) => void = () => undefined;
    vi.mocked(eventsApi.createOrder).mockReturnValue(new Promise((r) => (resolve = r)));
    const user = await selectOneSeat();
    await user.type(screen.getByLabelText(/Nom et prénom/), '  Léa Martin ');
    await user.type(screen.getByLabelText(/E-mail/), 'lea@exemple.fr');
    const submit = screen.getByRole('button', { name: 'Réserver' });
    await user.dblClick(submit);
    expect(eventsApi.createOrder).toHaveBeenCalledOnce();
    const [, request, key] = vi.mocked(eventsApi.createOrder).mock.calls[0]!;
    expect(request).toEqual({
      buyerName: 'Léa Martin',
      buyerEmail: 'lea@exemple.fr',
      paymentMethod: 'card',
      locale: 'fr',
      items: [{ ticketTypeId: 1, quantity: 1 }],
    });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    resolve({ token: 'abc' });
    expect(await screen.findByText('Page commande')).toBeInTheDocument();
  });

  it('places vendues entre-temps : message affiché et disponibilités rechargées', async () => {
    vi.mocked(eventsApi.createOrder).mockRejectedValue(new ApiError(409, 'sold_out', 'Plus assez de places « Fosse » (il en reste 0).'));
    const user = await selectOneSeat();
    await user.type(screen.getByLabelText(/Nom et prénom/), 'Léa');
    await user.type(screen.getByLabelText(/E-mail/), 'lea@exemple.fr');
    await user.click(screen.getByRole('button', { name: 'Réserver' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Plus assez de places');
    await waitFor(() => expect(eventsApi.get).toHaveBeenCalledTimes(2));
  });
});
