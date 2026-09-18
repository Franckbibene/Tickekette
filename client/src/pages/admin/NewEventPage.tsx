import { EventEditor } from '../../components/admin/EventEditor';
import { emptyEventForm } from '../../utils/eventForm';

export default function NewEventPage() {
  return <EventEditor eventId={null} initial={emptyEventForm} />;
}
