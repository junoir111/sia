import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { definirCode, deverrouiller, verrouiller } from '../src/appareil/verrou';
import { CHEMINS } from '../src/chemins';
import { VerrouAppli } from '../src/coquille/VerrouAppli';
import { enregistrerSession } from '../src/matrix/session';

// Le vrai verrou et le vrai stockage servent ici ; seuls le serveur et la surveillance du téléphone sont simulés.
const faux = vi.hoisted(() => ({ apresAbsence: null as null | (() => void) }));
vi.mock('../src/appareil/absence', () => ({
  surveillerAbsence: vi.fn((rappel: () => void) => {
    faux.apresAbsence = rappel;
    return () => {
      faux.apresAbsence = null;
    };
  }),
}));
vi.mock('../src/matrix/auth', () => ({
  deconnecter: vi.fn(async () => {
    localStorage.clear();
  }),
}));

const SESSION = { userId: '@puma:sia', accessToken: 'jeton', deviceId: 'APP' };

function Mur() {
  const [brouillon, setBrouillon] = useState('');
  return (
    <main>
      <p>le mur</p>
      <input
        aria-label="Brouillon"
        value={brouillon}
        onChange={(e) => setBrouillon(e.target.value)}
      />
    </main>
  );
}

function afficher() {
  return render(
    <MemoryRouter initialEntries={[CHEMINS.mur]}>
      <VerrouAppli>
        <Routes>
          <Route path={CHEMINS.accueil} element={<p>accueil</p>} />
          <Route path={CHEMINS.mur} element={<Mur />} />
        </Routes>
      </VerrouAppli>
    </MemoryRouter>,
  );
}

function taper(code: string) {
  for (const chiffre of code) fireEvent.click(screen.getByRole('button', { name: chiffre }));
}

beforeEach(() => {
  localStorage.clear();
  deverrouiller();
  faux.apresAbsence = null;
});
afterEach(() => {
  localStorage.clear();
  deverrouiller();
});

describe('Porte de l’appli', () => {
  it('pas connecté : les écrans sont visibles, aucun écran de code', () => {
    afficher();
    expect(screen.getByText('le mur')).toBeVisible();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('connecté sans code : on en choisit un (deux fois), puis les écrans s’ouvrent', async () => {
    enregistrerSession(SESSION);
    afficher();
    expect(screen.getByRole('heading', { name: 'Choisis ton code secret' })).toBeInTheDocument();
    expect(screen.getByText('le mur')).not.toBeVisible();
    taper('4821');
    taper('4821');
    await waitFor(() => expect(screen.getByText('le mur')).toBeVisible());
    expect(screen.queryByRole('heading', { name: 'Confirme ton code' })).not.toBeInTheDocument();
    expect(localStorage.getItem('sia.verrou')).not.toBeNull();
  });

  it('appli fermée à clé : un mauvais code laisse fermé, le bon code ouvre', async () => {
    enregistrerSession(SESSION);
    await definirCode('4821');
    verrouiller();
    afficher();
    expect(screen.getByRole('heading', { name: 'Entre ton code' })).toBeInTheDocument();
    expect(screen.getByText('le mur')).not.toBeVisible();

    taper('0000');
    expect(await screen.findByText('Code faux. Il te reste 4 essais.')).toBeInTheDocument();
    expect(screen.getByText('le mur')).not.toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('img', { name: '0 chiffre sur 4' })).toBeInTheDocument(),
    );

    taper('4821');
    await waitFor(() => expect(screen.getByText('le mur')).toBeVisible());
    expect(screen.queryByRole('heading', { name: 'Entre ton code' })).not.toBeInTheDocument();
  });

  it('après une longue absence, la porte se referme ; l’écran caché garde ce qui était tapé', async () => {
    enregistrerSession(SESSION);
    await definirCode('4821');
    afficher();
    expect(screen.getByText('le mur')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Brouillon'), { target: { value: 'salut Akanda' } });

    expect(faux.apresAbsence).not.toBeNull();
    act(() => faux.apresAbsence?.());
    expect(screen.getByRole('heading', { name: 'Entre ton code' })).toBeInTheDocument();
    expect(screen.getByText('le mur')).not.toBeVisible();

    taper('4821');
    await waitFor(() => expect(screen.getByText('le mur')).toBeVisible());
    expect(screen.getByLabelText('Brouillon')).toHaveValue('salut Akanda');
  });

  it('« Code oublié ? » : déconnexion, retour à l’accueil, plus aucune porte', async () => {
    enregistrerSession(SESSION);
    await definirCode('4821');
    verrouiller();
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Code oublié ?' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Se déconnecter' }),
    );
    await waitFor(() => expect(screen.getByText('accueil')).toBeVisible());
    expect(screen.queryByRole('heading', { name: 'Entre ton code' })).not.toBeInTheDocument();
    expect(localStorage.getItem('sia.verrou')).toBeNull();
    expect(localStorage.getItem('sia.session')).toBeNull();
  });

  it('la surveillance de l’absence s’arrête quand la porte quitte l’écran', () => {
    const { unmount } = afficher();
    expect(faux.apresAbsence).not.toBeNull();
    unmount();
    expect(faux.apresAbsence).toBeNull();
  });
});
