import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { App } from '@capacitor/app';
import { reculerSurEcran } from '../src/appareil/retour-systeme';
import { CHEMINS, cheminMur } from '../src/chemins';
import { RetourSysteme } from '../src/coquille/RetourSysteme';
import { LienRetour } from '../src/ui/LienRetour';

// Jamais le vrai téléphone : le plugin « App » de Capacitor est simulé.
const faux = vi.hoisted(() => ({
  ecoute: null as null | (() => void),
  retirer: vi.fn(),
  plateforme: 'android',
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_nom: string, rappel: () => void) => {
      faux.ecoute = rappel;
      return { remove: faux.retirer };
    }),
    exitApp: vi.fn(async () => undefined),
  },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => faux.plateforme } }));

/** Une page avec sa flèche du haut et une fenêtre qu'on peut ouvrir (comme « Mon compte »). */
function PageListe() {
  const [fenetre, setFenetre] = useState(false);
  return (
    <main>
      <LienRetour to={cheminMur('Akanda')} />
      <p>écran liste</p>
      <button type="button" onClick={() => setFenetre(true)}>
        Ouvrir la fenêtre
      </button>
      {fenetre && (
        <div className="feuille">
          <div className="feuille__voile" aria-hidden="true" onClick={() => setFenetre(false)} />
          <div role="dialog" aria-label="Fenêtre">
            Contenu de la fenêtre
          </div>
        </div>
      )}
    </main>
  );
}

function afficher(depart: string) {
  return render(
    <MemoryRouter initialEntries={[depart]}>
      <RetourSysteme />
      <Routes>
        <Route path={CHEMINS.accueil} element={<p>écran accueil</p>} />
        <Route
          path={CHEMINS.mur}
          element={
            <main>
              <p>écran mur</p>
              <Link to="/mur/metier/Plombier">vers la liste</Link>
            </main>
          }
        />
        <Route path={CHEMINS.listeMetier} element={<PageListe />} />
        <Route path={CHEMINS.profilPrestataire} element={<p>écran profil</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Appui sur le bouton « retour » du téléphone. */
function retourDuTelephone() {
  expect(faux.ecoute).not.toBeNull();
  act(() => faux.ecoute?.());
}

describe('Bouton retour du téléphone (Android)', () => {
  beforeEach(() => {
    faux.ecoute = null;
    faux.plateforme = 'android';
    faux.retirer.mockClear();
    vi.mocked(App.addListener).mockClear();
    vi.mocked(App.exitApp).mockClear();
  });

  it('fait comme la flèche du haut : même page, même destination', async () => {
    afficher('/mur/metier/Plombier');
    await vi.waitFor(() => expect(faux.ecoute).not.toBeNull());
    expect(screen.getByText('écran liste')).toBeInTheDocument();
    retourDuTelephone();
    expect(screen.getByText('écran mur')).toBeInTheDocument();
    expect(App.exitApp).not.toHaveBeenCalled();
  });

  it('une fenêtre ouverte se ferme d’abord ; l’appui suivant touche la flèche', async () => {
    afficher('/mur/metier/Plombier');
    await vi.waitFor(() => expect(faux.ecoute).not.toBeNull());
    act(() => screen.getByRole('button', { name: 'Ouvrir la fenêtre' }).click());
    expect(screen.getByRole('dialog', { name: 'Fenêtre' })).toBeInTheDocument();

    retourDuTelephone();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('écran liste')).toBeInTheDocument();

    retourDuTelephone();
    expect(screen.getByText('écran mur')).toBeInTheDocument();
  });

  it('sur une page sans flèche (profil), il ramène au Mur sans quitter l’appli', async () => {
    afficher(CHEMINS.profilPrestataire);
    await vi.waitFor(() => expect(faux.ecoute).not.toBeNull());
    retourDuTelephone();
    expect(screen.getByText('écran mur')).toBeInTheDocument();
    expect(App.exitApp).not.toHaveBeenCalled();
  });

  it.each([CHEMINS.mur, CHEMINS.accueil])(
    'sur %s (page de départ), il quitte l’appli',
    async (page) => {
      afficher(page);
      await vi.waitFor(() => expect(faux.ecoute).not.toBeNull());
      retourDuTelephone();
      expect(App.exitApp).toHaveBeenCalledTimes(1);
    },
  );

  it('suit les changements de page : de la liste au Mur, puis quitte', async () => {
    afficher(CHEMINS.mur);
    await vi.waitFor(() => expect(faux.ecoute).not.toBeNull());
    act(() => screen.getByRole('link', { name: 'vers la liste' }).click());
    expect(screen.getByText('écran liste')).toBeInTheDocument();
    retourDuTelephone();
    expect(screen.getByText('écran mur')).toBeInTheDocument();
    expect(App.exitApp).not.toHaveBeenCalled();
    retourDuTelephone();
    expect(App.exitApp).toHaveBeenCalledTimes(1);
  });

  it('l’écoute n’est posée qu’une fois, et retirée à la fermeture', async () => {
    const { unmount } = afficher(CHEMINS.mur);
    await vi.waitFor(() => expect(faux.ecoute).not.toBeNull());
    act(() => screen.getByRole('link', { name: 'vers la liste' }).click());
    expect(App.addListener).toHaveBeenCalledTimes(1);
    expect(App.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    expect(faux.retirer).not.toHaveBeenCalled();
    unmount();
    await vi.waitFor(() => expect(faux.retirer).toHaveBeenCalledTimes(1));
  });

  it('sur le web (hors Android), rien n’est branché', () => {
    faux.plateforme = 'web';
    afficher(CHEMINS.mur);
    expect(App.addListener).not.toHaveBeenCalled();
  });
});

describe('reculerSurEcran', () => {
  it('rend faux et ne touche à rien quand l’écran n’a ni flèche ni fenêtre', () => {
    document.body.innerHTML = '<main><p>Le Mur</p></main>';
    expect(reculerSurEcran()).toBe(false);
  });

  it('une fenêtre qui ne peut pas se fermer garde le retour (action en cours)', () => {
    document.body.innerHTML =
      '<main><a class="retour" href="#/x">Retour</a><div class="feuille"><div class="feuille__voile"></div></div></main>';
    const fleche = document.querySelector<HTMLElement>('.retour');
    const clic = vi.fn((e: Event) => e.preventDefault());
    fleche?.addEventListener('click', clic);
    expect(reculerSurEcran()).toBe(true);
    expect(clic).not.toHaveBeenCalled();
  });
});
