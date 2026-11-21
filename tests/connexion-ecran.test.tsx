import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { cheminApresConnexion } from '../src/coquille/apres-connexion';
import { Connexion } from '../src/ecrans/connexion/Connexion';
import { connecter } from '../src/matrix/auth';
import { enregistrerSession } from '../src/matrix/session';
import { definirCode } from '../src/appareil/verrou';

// Jamais le vrai serveur ni le vrai verrou : connexion, session, suite du parcours et code sont simulés.
vi.mock('../src/matrix/auth', () => ({ connecter: vi.fn() }));
vi.mock('../src/matrix/session', () => ({ enregistrerSession: vi.fn() }));
vi.mock('../src/coquille/apres-connexion', () => ({ cheminApresConnexion: vi.fn() }));
vi.mock('../src/appareil/verrou', () => ({ definirCode: vi.fn() }));

const SESSION = { userId: '@mangue:sia', accessToken: 'jeton-test', deviceId: 'APPAREIL' };

function afficher() {
  render(
    <MemoryRouter initialEntries={[CHEMINS.connexion]}>
      <Routes>
        <Route path={CHEMINS.connexion} element={<Connexion />} />
        <Route path={CHEMINS.accueil} element={<p>écran accueil</p>} />
        <Route path={CHEMINS.profilClient} element={<p>profil client</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function remplir() {
  fireEvent.change(screen.getByLabelText('Identifiant'), { target: { value: ' Mangue ' } });
  fireEvent.change(screen.getByLabelText('Code (4 chiffres)'), { target: { value: '4821' } });
}

const bouton = () => screen.getByRole('button', { name: /Entrer|Connexion/ });

describe('Écran Se connecter (E2)', () => {
  beforeEach(() => {
    vi.mocked(connecter).mockReset();
    vi.mocked(enregistrerSession).mockReset();
    vi.mocked(definirCode).mockReset().mockResolvedValue(undefined);
    vi.mocked(cheminApresConnexion)
      .mockReset()
      .mockResolvedValue({ ok: true, chemin: CHEMINS.profilClient });
  });

  it('titre, deux champs, bouton « Entrer » grisé tant que le code n’a pas 4 chiffres', () => {
    afficher();
    expect(screen.getByRole('heading', { name: 'Se connecter' })).toBeInTheDocument();
    expect(bouton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Identifiant'), { target: { value: 'mangue' } });
    fireEvent.change(screen.getByLabelText('Code (4 chiffres)'), { target: { value: '48' } });
    expect(bouton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Code (4 chiffres)'), { target: { value: '4821' } });
    expect(bouton()).toBeEnabled();
  });

  it('succès : identifiant en minuscules, code gardé comme verrou, session gardée, page du profil', async () => {
    vi.mocked(connecter).mockResolvedValue({ ok: true, session: SESSION });
    afficher();
    remplir();
    fireEvent.click(bouton());
    expect(await screen.findByText('profil client')).toBeInTheDocument();
    expect(connecter).toHaveBeenCalledWith('mangue', '4821');
    expect(enregistrerSession).toHaveBeenCalledWith(SESSION);
    // Le code qui ouvre le compte devient le verrou local : pas de deuxième écran de code ensuite.
    expect(definirCode).toHaveBeenCalledWith('4821');
    expect(cheminApresConnexion).toHaveBeenCalledWith(SESSION);
  });

  it('mauvais code : message rouge sous le champ du code', async () => {
    vi.mocked(connecter).mockResolvedValue({ ok: false, erreur: 'identifiants' });
    afficher();
    remplir();
    fireEvent.click(bouton());
    expect(await screen.findByText('Identifiant ou code incorrect.')).toBeInTheDocument();
    expect(enregistrerSession).not.toHaveBeenCalled();
  });

  it('pas de réseau : bandeau', async () => {
    vi.mocked(connecter).mockResolvedValue({ ok: false, erreur: 'reseau' });
    afficher();
    remplir();
    fireEvent.click(bouton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pas de connexion. Réessaie dans un instant.',
    );
  });

  it('connecté mais profil illisible (réseau) : nouvel essai sans se reconnecter', async () => {
    vi.mocked(connecter).mockResolvedValue({ ok: true, session: SESSION });
    vi.mocked(cheminApresConnexion).mockResolvedValueOnce({ ok: false, erreur: 'reseau' });
    afficher();
    remplir();
    fireEvent.click(bouton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
    fireEvent.click(bouton());
    expect(await screen.findByText('profil client')).toBeInTheDocument();
    expect(connecter).toHaveBeenCalledTimes(1);
  });

  it('la flèche ramène à l’accueil', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(screen.getByText('écran accueil')).toBeInTheDocument();
  });
});
