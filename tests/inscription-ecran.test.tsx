import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { definirCode } from '../src/appareil/verrou';
import { CHEMINS } from '../src/chemins';
import { Inscription } from '../src/ecrans/inscription/Inscription';
import { creerCompte } from '../src/matrix/auth';
import { enregistrerSession } from '../src/matrix/session';

// Jamais le vrai serveur : la création de compte et la session sont simulées.
vi.mock('../src/matrix/auth', () => ({ creerCompte: vi.fn() }));
vi.mock('../src/matrix/session', () => ({ enregistrerSession: vi.fn() }));
vi.mock('../src/appareil/verrou', () => ({ definirCode: vi.fn() }));

const creerCompteSimule = vi.mocked(creerCompte);
const SESSION = { userId: '@mangue-douce:sia', accessToken: 'jeton-test', deviceId: 'APPAREIL' };

function afficher() {
  render(
    <MemoryRouter initialEntries={[CHEMINS.inscription]}>
      <Routes>
        <Route path={CHEMINS.inscription} element={<Inscription />} />
        <Route path={CHEMINS.accueil} element={<p>écran accueil</p>} />
        <Route path={CHEMINS.profilPrestataire} element={<p>profil prestataire</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function remplir(code: string) {
  fireEvent.change(screen.getByLabelText('Identifiant'), { target: { value: 'Mangue-Douce' } });
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'palmier2026x' } });
  fireEvent.change(screen.getByLabelText('Confirme le mot de passe'), {
    target: { value: 'palmier2026x' },
  });
  fireEvent.change(screen.getByLabelText('Code secret (4 chiffres)'), {
    target: { value: '4821' },
  });
  fireEvent.change(screen.getByLabelText("Code d'invitation"), { target: { value: code } });
  fireEvent.click(screen.getByLabelText("J'ai 18 ans ou plus"));
}

const bouton = () => screen.getByRole('button', { name: /Créer mon compte|Création/ });

describe('Écran Créer mon compte (E3)', () => {
  beforeEach(() => {
    creerCompteSimule.mockReset();
    vi.mocked(enregistrerSession).mockReset();
    vi.mocked(definirCode).mockReset().mockResolvedValue(undefined);
  });

  it('le bouton est désactivé tant que le formulaire est incomplet', () => {
    afficher();
    expect(screen.getByRole('heading', { name: 'Créer mon compte' })).toBeInTheDocument();
    expect(bouton()).toBeDisabled();
  });

  it('affiche les erreurs locales sans appeler le serveur', () => {
    afficher();
    remplir('P-AAAA-BBBB-CCCC');
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'court' } });
    fireEvent.click(bouton());
    expect(screen.getByText('Au moins 10 signes.')).toBeInTheDocument();
    expect(creerCompteSimule).not.toHaveBeenCalled();
  });

  it('code refusé : message sous le code, bouton grisé jusqu’à modification du code', async () => {
    creerCompteSimule.mockResolvedValue({ ok: false, erreur: 'code-invalide' });
    afficher();
    remplir('PALMIER-48');
    fireEvent.click(bouton());

    expect(await screen.findByText("Code d'invitation inconnu.")).toBeInTheDocument();
    expect(screen.getByLabelText("Code d'invitation")).toHaveAttribute('aria-invalid', 'true');
    expect(bouton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Code d'invitation"), {
      target: { value: 'PALMIER-49' },
    });
    expect(bouton()).toBeEnabled();
  });

  it('pas de réseau : bandeau qui dit quoi faire', async () => {
    creerCompteSimule.mockResolvedValue({ ok: false, erreur: 'reseau' });
    afficher();
    remplir('PALMIER-48');
    fireEvent.click(bouton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pas de connexion. Réessaie dans un instant.',
    );
  });

  it('succès avec un code P : session enregistrée puis profil prestataire', async () => {
    creerCompteSimule.mockResolvedValue({ ok: true, session: SESSION });
    afficher();
    remplir('p-aaaa-bbbb-cccc');
    fireEvent.click(bouton());

    expect(await screen.findByText('profil prestataire')).toBeInTheDocument();
    expect(creerCompteSimule).toHaveBeenCalledWith(
      'mangue-douce',
      'palmier2026x',
      'P-AAAA-BBBB-CCCC',
    );
    expect(enregistrerSession).toHaveBeenCalledWith(SESSION);
    // Le code choisi dans le formulaire devient le code de verrouillage du téléphone.
    expect(definirCode).toHaveBeenCalledWith('4821');
  });

  it('le bouton reste occupé pendant que le téléphone prépare le code (pas de deuxième envoi)', async () => {
    creerCompteSimule.mockResolvedValue({ ok: true, session: SESSION });
    let finir: () => void = () => undefined;
    vi.mocked(definirCode).mockReturnValue(
      new Promise<void>((resoudre) => {
        finir = resoudre;
      }),
    );
    afficher();
    remplir('p-aaaa-bbbb-cccc');
    fireEvent.click(bouton());
    await waitFor(() => expect(definirCode).toHaveBeenCalledTimes(1));
    expect(bouton()).toBeDisabled();
    fireEvent.click(bouton());
    fireEvent.submit(bouton().closest('form') as HTMLFormElement);
    expect(creerCompteSimule).toHaveBeenCalledTimes(1);
    finir();
    expect(await screen.findByText('profil prestataire')).toBeInTheDocument();
  });

  it('le champ code secret n’accepte que 4 chiffres et se cache, avec un œil pour le voir', () => {
    afficher();
    const champ = screen.getByLabelText('Code secret (4 chiffres)');
    fireEvent.change(champ, { target: { value: '48a2 1999' } });
    expect(champ).toHaveValue('4821');
    expect(champ).toHaveAttribute('type', 'password');
    expect(champ).toHaveAttribute('inputmode', 'numeric');
    fireEvent.click(screen.getByRole('button', { name: 'Afficher le code' }));
    expect(champ).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Cacher le code' })).toBeInTheDocument();
  });

  it('un code secret trop court : message sous le champ, rien n’est envoyé', () => {
    afficher();
    remplir('P-AAAA-BBBB-CCCC');
    fireEvent.change(screen.getByLabelText('Code secret (4 chiffres)'), {
      target: { value: '48' },
    });
    fireEvent.click(bouton());
    expect(screen.getByText('Ton code secret a 4 chiffres.')).toBeInTheDocument();
    expect(creerCompteSimule).not.toHaveBeenCalled();
  });

  it('le téléphone refuse de garder le code : le compte est créé et on avance (le code sera redemandé)', async () => {
    creerCompteSimule.mockResolvedValue({ ok: true, session: SESSION });
    vi.mocked(definirCode).mockRejectedValue(new Error('stockage plein'));
    afficher();
    remplir('p-aaaa-bbbb-cccc');
    fireEvent.click(bouton());
    expect(await screen.findByText('profil prestataire')).toBeInTheDocument();
  });

  it('le bouton reste grisé sans code secret', () => {
    afficher();
    remplir('P-AAAA-BBBB-CCCC');
    fireEvent.change(screen.getByLabelText('Code secret (4 chiffres)'), { target: { value: '' } });
    expect(bouton()).toBeDisabled();
  });

  it('la flèche retour ramène à l’accueil', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(screen.getByText('écran accueil')).toBeInTheDocument();
  });
});
