import type { ReactNode } from 'react';
import type { ApiQuery } from '../../hooks/useApiQuery';
import { EmptyState, ErrorMessage, Loading } from './Feedback';

interface Props<T> {
  query: ApiQuery<T>;
  // Contenu affiché quand la réponse est une liste vide.
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}

// Affichage uniforme des quatre états d'une donnée chargée : chargement, erreur, vide, succès.
export function QueryView<T>({ query, empty, children }: Props<T>) {
  if (query.data === null) {
    return query.error ? <ErrorMessage error={query.error} onRetry={query.reload} /> : <Loading />;
  }
  if (empty !== undefined && Array.isArray(query.data) && query.data.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <>
      {query.error && <ErrorMessage error={query.error} onRetry={query.reload} />}
      {children(query.data)}
    </>
  );
}
