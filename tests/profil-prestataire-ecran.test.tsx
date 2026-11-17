import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { ProfilPrestataire } from '../src/ecrans/profil-prestataire/ProfilPrestataire';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { monStatutActif, publierStatut, retirerStatut } from '../src/matrix/mur';
import { enregistrerProfil, lireProfil } from '../src/matrix/profil';
import { lireSession } from '../src/matrix/session';
import { ecrireDisponible, lireDisponible } from '../src/appareil/disponible';

// Jamais le vrai serveur ni le vrai stockage : tout est simulé.
vi.mock('../src/matrix/profil', () => ({ lireProfil: vi.fn(), enregistrerProfil: vi.fn() }));
vi.mock('../src/matrix/session', () => ({ lireSession: vi.fn() }));
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/matrix/mur', () => ({
  monStatutActif: vi.fn(),
  publierStatut: vi.fn(),
  retirerStatut: vi.fn(),
}));
vi.mock('../src/matrix/bulles', () => ({
  ecouterBulles: vi.fn(() => () => undefined),
  listerBulles: vi.fn(() => []),
}));
vi.mock('../src/appareil/disponible', () => ({
  lireDisponible: vi.fn(),
  ecrireDisponible: vi.fn(),
}));
vi.mock('../src/appareil/photo', () => ({
  lirePhoto: vi.fn().mockResolvedValue(null),
  preparerPhoto: vi.fn(),
  enregistrerPhoto: vi.fn(),
  effacerPhoto: vi.fn(),
}));

const CLIENT = { simule: true } as never;
const SESSION = {
  userId: '@mangue-douce:sia.tail94dc60.ts.net',
  accessToken: 'jeton-test',
  deviceId: 'APPAREIL',
};

function afficher() {
  render(
    <MemoryRouter initialEntries={[CHEMINS.profilPrestataire]}>
      <Routes>
        <Route path={CHEMINS.profilPrestataire} element={<ProfilPrestataire />} />
        <Route path={CHEMINS.accueil} element={<p>écran accueil</p>} />
        <Route path={CHEMINS.bulles} element={<p>écran bulles</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const boutonSia = () => screen.getByRole('button', { name: 'SIA' });

async function attendreChargement() {
  await waitFor(() => expect(screen.getByLabelText('Ton métier')).not.toBeDisabled());
}

function remplir() {
  fireEvent.change(screen.getByLabelText('Ton métier'), { target: { value: 'Plombier' } });
  fireEvent.click(screen.getByRole('button', { name: 'Je me déplace' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Quartier' }), {
    target: { value: 'Akanda' },
  });
  fireEvent.change(screen.getByLabelText('Service 1'), { target: { value: 'Réparer une fuite' } });
  fireEvent.change(screen.getByLabelText('Prix du service 1, en FCFA'), {
    target: { value: '5000' },
  });
}

describe('Écran Profil prestataire (E5)', () => {
  beforeEach(() => {
    vi.mocked(lireSession).mockReturnValue(SESSION);
    vi.mocked(lireProfil).mockReset().mockResolvedValue({ ok: true, profil: null });
    vi.mocked(enregistrerProfil).mockReset();
    vi.mocked(lireDisponible).mockReturnValue(false);
    vi.mocked(ecrireDisponible).mockReset();
    vi.mocked(useMatrix).mockReturnValue({ client: CLIENT, etat: 'pret' });
    vi.mocked(monStatutActif).mockReset().mockReturnValue(null);
    vi.mocked(publierStatut).mockReset().mockResolvedValue('$statut');
    vi.mocked(retirerStatut).mockReset().mockResolvedValue(undefined);
  });

  it('affiche le pseudo proposé et le bouton SIA inactif au départ', async () => {
    afficher();
    expect(screen.getByRole('heading', { name: 'Ton profil' })).toBeInTheDocument();
    expect(screen.getByText('mangue-douce')).toBeInTheDocument();
    await attendreChargement();
    expect(boutonSia()).toBeDisabled();
  });

  it('sans session : retour à l’accueil', () => {
    vi.mocked(lireSession).mockReturnValue(null);
    afficher();
    expect(screen.getByText('écran accueil')).toBeInTheDocument();
  });

  it('propose des quartiers et en choisit un au toucher', async () => {
    afficher();
    await attendreChargement();
    const champ = screen.getByRole('combobox', { name: 'Quartier' });
    fireEvent.change(champ, { target: { value: 'ak' } });
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Akanda', 'Akébé', 'Akournam', 'Alénakiri']);
    expect(options[0]?.querySelector('strong')).toHaveTextContent('Ak');
    expect(options[3]?.querySelector('strong')).toHaveTextContent(/^ak$/);
    fireEvent.click(screen.getByRole('option', { name: 'Akébé' }));
    expect(champ).toHaveValue('Akébé');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('enregistrement réussi : bouton vert et phrase, puis éteint au second toucher', async () => {
    vi.mocked(enregistrerProfil).mockResolvedValue({ ok: true });
    afficher();
    await attendreChargement();
    remplir();
    expect(boutonSia()).toBeEnabled();
    fireEvent.click(boutonSia());

    expect(await screen.findByText('Tu es visible à Akanda.')).toBeInTheDocument();
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'true');
    expect(ecrireDisponible).toHaveBeenCalledWith(true);
    expect(enregistrerProfil).toHaveBeenCalledWith(SESSION, {
      version: 1,
      role: 'prestataire',
      pseudo: 'mangue-douce',
      metier: 'Plombier',
      zone: 'Akanda',
      modalite: 'deplace',
      services: [{ label: 'Réparer une fuite', prix: 5000 }],
    });

    fireEvent.change(screen.getByLabelText('Service 2'), {
      target: { value: 'Déboucher un évier' },
    });
    expect(screen.getByText('Touche SIA pour enregistrer.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Service 2'), { target: { value: '' } });
    fireEvent.click(boutonSia());
    expect(await screen.findByText('Tu es visible à Akanda.')).toBeInTheDocument();

    const [client, statut] = vi.mocked(publierStatut).mock.calls[0] ?? [];
    expect(client).toBe(CLIENT);
    expect(statut).toMatchObject({ pseudo: 'mangue-douce', metier: 'Plombier', zone: 'Akanda' });
    expect(statut?.fin).toBeGreaterThan(Date.now() + 23 * 3_600_000);

    fireEvent.click(boutonSia());
    expect(await screen.findByText("Tu n'es plus visible.")).toBeInTheDocument();
    expect(retirerStatut).toHaveBeenCalledWith(CLIENT);
    expect(ecrireDisponible).toHaveBeenLastCalledWith(false);
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
  });

  it('erreur de saisie : message sous les services, rien n’est envoyé', async () => {
    afficher();
    await attendreChargement();
    remplir();
    fireEvent.change(screen.getByLabelText('Prix du service 1, en FCFA'), {
      target: { value: 'cher' },
    });
    fireEvent.click(boutonSia());
    expect(screen.getByText('Écris un prix en FCFA pour chaque service.')).toBeInTheDocument();
    expect(enregistrerProfil).not.toHaveBeenCalled();
  });

  it('pas de réseau : bandeau qui dit quoi faire', async () => {
    vi.mocked(enregistrerProfil).mockResolvedValue({ ok: false, erreur: 'reseau' });
    afficher();
    await attendreChargement();
    remplir();
    fireEvent.click(boutonSia());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pas de connexion. Réessaie dans un instant.',
    );
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
    expect(ecrireDisponible).not.toHaveBeenCalled();
  });

  it('remplit les champs avec le profil déjà enregistré', async () => {
    vi.mocked(lireDisponible).mockReturnValue(true);
    vi.mocked(lireProfil).mockResolvedValue({
      ok: true,
      profil: {
        version: 1,
        role: 'prestataire',
        pseudo: 'mangue',
        metier: 'Plombier',
        zone: 'Owendo',
        modalite: 'les-deux',
        services: [{ label: 'Réparer une fuite', prix: 10000 }],
      },
    });
    afficher();
    expect(await screen.findByText('Plombier')).toBeInTheDocument();
    expect(screen.getByText('Tu es visible à Owendo.')).toBeInTheDocument();
    expect(screen.getByLabelText('Prix du service 1, en FCFA')).toHaveValue('10 000');
    expect(screen.getByRole('button', { name: 'Je reçois' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('statut encore publié sur le Mur : bouton vert dès l’ouverture', async () => {
    vi.mocked(lireProfil).mockResolvedValue({
      ok: true,
      profil: {
        version: 1,
        role: 'prestataire',
        pseudo: 'mangue',
        metier: 'Plombier',
        zone: 'Owendo',
        modalite: 'deplace',
        services: [{ label: 'Réparer une fuite', prix: 5000 }],
      },
    });
    vi.mocked(monStatutActif).mockReturnValue({
      eventId: '$statut',
      statut: { pseudo: 'mangue', metier: 'Plombier', zone: 'Owendo', fin: Date.now() + 60_000 },
    });
    afficher();
    expect(await screen.findByText('Tu es visible à Owendo.')).toBeInTheDocument();
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'true');
  });

  it('publication du statut impossible (réseau) : bandeau, bouton reste gris', async () => {
    vi.mocked(enregistrerProfil).mockResolvedValue({ ok: true });
    vi.mocked(publierStatut).mockRejectedValue(
      Object.assign(new Error('coupé'), { name: 'ConnectionError' }),
    );
    afficher();
    await attendreChargement();
    remplir();
    fireEvent.click(boutonSia());
    expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
    expect(ecrireDisponible).not.toHaveBeenCalled();
  });

  it('petit accès aux bulles en haut', async () => {
    afficher();
    await attendreChargement();
    fireEvent.click(screen.getByRole('link', { name: 'Bulles' }));
    expect(screen.getByText('écran bulles')).toBeInTheDocument();
  });
});
