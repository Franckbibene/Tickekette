import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Broken(): never {
  throw new Error('Cannot read properties of undefined (reading "x")');
}

describe('ErrorBoundary', () => {
  it('une erreur de rendu affiche un message compréhensible, pas une page blanche ni la trace technique', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('un problème est survenu');
    expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument();
    spy.mockRestore();
  });
});
