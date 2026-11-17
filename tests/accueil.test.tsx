import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { Accueil } from '../src/ecrans/accueil/Accueil';

function afficher() {
  render(
    <MemoryRouter initialEntries={[CHEMINS.accueil]}>
      <Routes>
        <Route path={CHEMINS.accueil} element={<Accueil />} />
        <Route path={CHEMINS.inscription} element={<p>écran inscription</p>} />
        <Route path={CHEMINS.connexion} element={<p>écran connexion</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Accueil (E1)', () => {
  it('affiche le nom SIA et la mention « sur invitation »', () => {
    afficher();
    expect(screen.getByRole('heading', { name: 'SIA' })).toBeInTheDocument();
    expect(screen.getByText('Sur invitation seulement.')).toBeInTheDocument();
  });

  it('« Créer mon compte » mène à l’inscription', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(screen.getByText('écran inscription')).toBeInTheDocument();
  });

  it('« J’ai déjà un compte » mène à la connexion', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: "J'ai déjà un compte" }));
    expect(screen.getByText('écran connexion')).toBeInTheDocument();
  });
});
