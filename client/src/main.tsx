import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root introuvable dans index.html.');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Application disponible hors ligne une fois chargée (contrôle à l'entrée).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* sans service worker, l'application fonctionne normalement en ligne */
    });
  });
}
