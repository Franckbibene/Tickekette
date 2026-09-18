import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// jsdom annonce une langue anglaise : les tests vérifient l'interface française.
beforeEach(() => {
  localStorage.setItem('tkk_lang', JSON.stringify('fr'));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
