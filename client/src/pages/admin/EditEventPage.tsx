import { useParams } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { EventEditor } from '../../components/admin/EventEditor';
import { QueryView } from '../../components/common/QueryView';
import { useApiQuery } from '../../hooks/useApiQuery';
import { eventFormFromEvent } from '../../utils/eventForm';
import { parseRouteId } from '../../utils/url';
import NotFoundPage from '../public/NotFoundPage';

export default function EditEventPage() {
  const eventId = parseRouteId(useParams().id);
  const event = useApiQuery(eventId === null ? null : `admin:event:${eventId}`, (signal) => adminApi.event(eventId ?? 0, signal));
  if (eventId === null) return <NotFoundPage />;
  // L'éditeur n'est monté qu'une fois l'événement chargé : son état initial vient des données serveur.
  return <QueryView query={event}>{(data) => <EventEditor eventId={eventId} initial={() => eventFormFromEvent(data)} />}</QueryView>;
}
