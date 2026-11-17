import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigation } from './navigation';
import './ui/theme.css';

const racine = document.getElementById('racine');
if (!racine) {
  throw new Error('Élément #racine introuvable dans index.html');
}

createRoot(racine).render(
  <StrictMode>
    <Navigation />
  </StrictMode>,
);
