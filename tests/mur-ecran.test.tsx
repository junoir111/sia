import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  CHEMINS,
  cheminFicheDemande,
  cheminFichePrestataire,
  cheminListeMetier,
  cheminMur,
} from '../src/chemins';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { FicheDemande } from '../src/ecrans/fiche-demande/FicheDemande';
import { FichePrestataire } from '../src/ecrans/fiche-prestataire/FichePrestataire';
import { ListeMetier } from '../src/ecrans/liste-metier/ListeMetier';
import { Mur } from '../src/ecrans/mur/Mur';
import { ilYa, lireSucces } from '../src/ecrans/mur/navigation-mur';
import { demanderA, direOui } from '../src/matrix/bulles';
import { ecouterMur } from '../src/matrix/mur';
import { lireProfil, lireProfilClient } from '../src/matrix/profil';
import { lireSession } from '../src/matrix/session';

// Jamais le vrai serveur : le Mur, les bulles et les profils sont simulés.
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/matrix/session', () => ({ lireSession: vi.fn() }));
vi.mock('../src/matrix/profil', () => ({ lireProfil: vi.fn(), lireProfilClient: vi.fn() }));
vi.mock('../src/matrix/mur', () => ({ ecouterMur: vi.fn() }));
vi.mock('../src/matrix/bulles', () => ({
  ecouterBulles: vi.fn(() => () => undefined),
  listerBulles: vi.fn(() => []),
  demanderA: vi.fn(),
  direOui: vi.fn(),
}));

const CLIENT = { simule: true } as never;
const SESSION = { userId: '@moi:sia', accessToken: 'jeton', deviceId: 'A' };
const PLUS_TARD = Date.now() + 3_600_000;

const STATUTS = [
  {
    eventId: '$p1',
    userId: '@mangue:sia',
    pseudo: 'mangue-douce',
    metier: 'Plombier',
    zone: 'Akanda',
    fin: PLUS_TARD,
    modalite: 'recoit',
    services: [
      { label: "Fuite d'eau", prix: 5000 },
      { label: 'Débouchage', prix: 10000 },
    ],
  },
  {
    eventId: '$p2',
    userId: '@baobab:sia',
    pseudo: 'baobab-12',
    metier: 'Plombier',
    zone: 'Owendo',
    fin: PLUS_TARD,
  },
];
const DEMANDES = [
  {
    eventId: '$d1',
    userId: '@palmier:sia',
    pseudo: 'palmier-48',
    service: 'Plombier',
    zone: 'Akanda',
    texte: "Fuite sous l'évier",
    budget: 5000,
    fin: PLUS_TARD,
    creeLe: Date.now() - 12 * 60_000,
  },
];

const PROFIL_PRESTA = {
  ok: true as const,
  profil: {
    version: 1 as const,
    role: 'prestataire' as const,
    pseudo: 'cocotier-7',
    metier: 'Plombier',
    zone: 'Akanda',
    modalite: 'deplace' as const,
    services: [],
  },
};
const PROFIL_CLIENT = {
  ok: true as const,
  profil: { version: 1 as const, role: 'client' as const, pseudo: 'moi-client', zone: 'Owendo' },
};

function murSimule(statuts: unknown[] = STATUTS, demandes: unknown[] = DEMANDES) {
  vi.mocked(ecouterMur).mockImplementation(((_c: unknown, rappel: (m: unknown) => void) => {
    rappel({ statuts, demandes });
    return () => undefined;
  }) as never);
}

function Etat() {
  const l = useLocation();
  return <p data-testid="lieu">{l.pathname + l.search}</p>;
}

function afficher(adresse: string | { pathname: string; state: unknown }) {
  render(
    <MemoryRouter initialEntries={[adresse]}>
      <Etat />
      <Routes>
        <Route path={CHEMINS.mur} element={<Mur />} />
        <Route path={CHEMINS.listeMetier} element={<ListeMetier />} />
        <Route path={CHEMINS.fichePrestataire} element={<FichePrestataire />} />
        <Route path={CHEMINS.ficheDemande} element={<FicheDemande />} />
        <Route path={CHEMINS.profilClient} element={<p>écran profil client</p>} />
        <Route path={CHEMINS.profilPrestataire} element={<p>écran profil prestataire</p>} />
        <Route path={CHEMINS.bulles} element={<p>écran bulles</p>} />
        <Route path={CHEMINS.accueil} element={<p>écran accueil</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const lieu = () => screen.getByTestId('lieu').textContent;

describe('Écrans du Mur', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(useMatrix).mockReturnValue({ client: CLIENT, etat: 'pret' });
    vi.mocked(lireSession).mockReturnValue(SESSION);
    vi.mocked(lireProfil).mockReset().mockResolvedValue({ ok: true, profil: null });
    vi.mocked(lireProfilClient).mockReset().mockResolvedValue(PROFIL_CLIENT);
    vi.mocked(demanderA).mockReset().mockResolvedValue('!bulle:sia');
    vi.mocked(direOui).mockReset().mockResolvedValue('!bulle:sia');
    murSimule();
  });

  describe('Le Mur', () => {
    it('montre seulement les métiers avec des prestataires, sans phrase de demandes, et le rond d’initiale', async () => {
      afficher(CHEMINS.mur);
      expect(screen.getByRole('heading', { name: 'Le Mur' })).toBeInTheDocument();
      expect(screen.queryByText(/client/i)).not.toBeInTheDocument();
      const plombier = screen.getByRole('link', { name: /Plombier/ });
      expect(within(plombier).getByText('2 dispo')).toBeInTheDocument();
      expect(plombier).not.toHaveTextContent(/demande/);
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.queryByRole('link', { name: /Peintre/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mon compte' })).toHaveTextContent('M');
      await waitFor(() => expect(screen.getByRole('link', { name: 'Publier une demande' })));
    });

    it('aucun prestataire : message d’état vide', () => {
      murSimule([], DEMANDES);
      afficher(CHEMINS.mur);
      expect(screen.getByText('Aucun prestataire disponible pour l’instant.')).toBeInTheDocument();
    });

    it('un quartier sans prestataire : « Personne de disponible ici. »', () => {
      afficher(CHEMINS.mur);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Port-Gentil' } });
      expect(screen.getByText('Personne de disponible ici.')).toBeInTheDocument();
    });

    it('un métier absent du Mur est traité comme un quartier', () => {
      afficher(CHEMINS.mur);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Peintre' } });
      expect(lieu()).toBe('/mur?quartier=Peintre');
      expect(screen.getByText('Personne de disponible ici.')).toBeInTheDocument();
    });

    it('un quartier tapé filtre les chiffres et reste dans l’adresse', () => {
      afficher(CHEMINS.mur);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Owendo' } });
      const plombier = screen.getByRole('link', { name: /Plombier/ });
      expect(within(plombier).getByText('1 dispo')).toBeInTheDocument();
      expect(lieu()).toBe('/mur?quartier=Owendo');
      expect(plombier).toHaveAttribute('href', '/mur/metier/Plombier?quartier=Owendo');
    });

    it('un métier tapé ne garde que les cases qui le contiennent', () => {
      afficher(CHEMINS.mur);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'plomb' } });
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(lieu()).toBe('/mur?q=plomb');
    });

    it('un métier tapé après un quartier garde le quartier dans l’adresse et les liens', () => {
      afficher(CHEMINS.mur);
      const champ = screen.getByRole('searchbox');
      fireEvent.change(champ, { target: { value: 'Akanda' } });
      fireEvent.change(champ, { target: { value: 'plomb' } });
      expect(lieu()).toBe('/mur?quartier=Akanda&q=plomb');
      expect(screen.getByRole('link', { name: /Plombier/ })).toHaveAttribute(
        'href',
        '/mur/metier/Plombier?quartier=Akanda',
      );
    });

    it('reprend le métier tapé de l’adresse', () => {
      afficher('/mur?quartier=Akanda&q=plomb');
      expect(screen.getByRole('searchbox')).toHaveValue('plomb');
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });

    it('retour par la flèche : texte tapé et position de défilement retrouvés', () => {
      const defiler = vi.fn();
      vi.stubGlobal('scrollTo', defiler);
      Object.defineProperty(window, 'scrollY', { value: 340, configurable: true });
      afficher(CHEMINS.mur);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'plomb' } });
      fireEvent.click(screen.getByRole('link', { name: /Plombier/ }));
      fireEvent.click(screen.getByRole('link', { name: 'Retour' }));
      expect(screen.getByRole('searchbox')).toHaveValue('plomb');
      expect(defiler).toHaveBeenLastCalledWith(0, 340);
      vi.unstubAllGlobals();
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    });

    it('stockage refusé : le Mur s’affiche quand même', () => {
      const refus = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('refusé');
      });
      afficher(CHEMINS.mur);
      fireEvent.click(screen.getByRole('link', { name: /Plombier/ }));
      expect(screen.getByRole('heading', { name: 'Plombier' })).toBeInTheDocument();
      refus.mockRestore();
    });

    it('reprend le quartier de l’adresse', () => {
      afficher(cheminMur('Akanda'));
      expect(screen.getByRole('searchbox')).toHaveValue('Akanda');
      expect(within(screen.getByRole('link', { name: /Plombier/ })).getByText('1 dispo')).toBeInTheDocument();
    });

    it('toucher une case ouvre la liste du métier avec le quartier', () => {
      afficher(cheminMur('Akanda'));
      fireEvent.click(screen.getByRole('link', { name: /Plombier/ }));
      expect(screen.getByRole('heading', { name: 'Plombier · Akanda' })).toBeInTheDocument();
    });

    it('client : « + » mène au profil client', async () => {
      afficher(CHEMINS.mur);
      fireEvent.click(await screen.findByRole('link', { name: 'Publier une demande' }));
      expect(screen.getByText('écran profil client')).toBeInTheDocument();
    });

    it('prestataire : « Je suis disponible » mène au profil prestataire', async () => {
      vi.mocked(lireProfil).mockResolvedValue(PROFIL_PRESTA);
      afficher(CHEMINS.mur);
      fireEvent.click(await screen.findByRole('link', { name: 'Je suis disponible' }));
      expect(screen.getByText('écran profil prestataire')).toBeInTheDocument();
    });

    it('Mon compte : profil, bulles et Se déconnecter ; Fermer referme', async () => {
      afficher(CHEMINS.mur);
      await screen.findByRole('link', { name: 'Publier une demande' });
      fireEvent.click(screen.getByRole('button', { name: 'Mon compte' }));
      const panneau = screen.getByRole('dialog', { name: 'moi-client' });
      expect(within(panneau).getByText('Client')).toBeInTheDocument();
      expect(within(panneau).getByRole('link', { name: /Mon profil/ })).toHaveAttribute(
        'href',
        CHEMINS.profilClient,
      );
      expect(within(panneau).getByRole('link', { name: /Voir mes bulles/ })).toHaveAttribute(
        'href',
        CHEMINS.bulles,
      );
      expect(within(panneau).getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
      fireEvent.click(within(panneau).getByRole('button', { name: 'Fermer' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('sans réseau : bandeau qui dit quoi faire', () => {
      vi.mocked(useMatrix).mockReturnValue({ client: null, etat: 'erreur-reseau' });
      afficher(CHEMINS.mur);
      expect(screen.getByRole('alert')).toHaveTextContent('Pas de connexion.');
    });
  });

  describe('Liste d’un métier', () => {
    it('titre avec le quartier, disponibles seulement (jamais de demandes), flèche retour avec le quartier', () => {
      afficher(cheminListeMetier('Plombier', 'Akanda'));
      expect(screen.getByRole('heading', { name: 'Plombier · Akanda' })).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Disponibles maintenant · 1' }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Demande/)).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Retour' })).toHaveAttribute(
        'href',
        '/mur?quartier=Akanda',
      );
      expect(screen.getByRole('link', { name: /mangue-douce/ })).toHaveAttribute(
        'href',
        '/mur/prestataire/%24p1?metier=Plombier&quartier=Akanda',
      );
    });

    it('la modalité s’affiche sur la carte quand elle est connue, pas sinon', () => {
      afficher(cheminListeMetier('Plombier'));
      expect(screen.getByText('Akanda · Reçoit sur place')).toBeInTheDocument();
      expect(screen.getByText('Owendo')).toBeInTheDocument();
    });

    it('rien pour ce métier : phrase claire', () => {
      afficher(cheminListeMetier('Peintre'));
      expect(screen.getByText(/Personne pour l'instant/)).toBeInTheDocument();
    });

    it('le message de succès vient de l’état de navigation, offre le lien vers les bulles, puis s’efface', async () => {
      afficher({
        pathname: '/mur/metier/Plombier',
        state: { succes: 'Demande envoyée à mangue-douce' },
      });
      expect(await screen.findByRole('status')).toHaveTextContent('Demande envoyée à mangue-douce');
      expect(screen.getByRole('link', { name: 'Voir mes bulles' })).toHaveAttribute(
        'href',
        CHEMINS.bulles,
      );
    });
  });

  describe('Fiche prestataire', () => {
    it('montre le prix « à partir de » et la flèche vers la liste', () => {
      afficher(cheminFichePrestataire('$p1', 'Plombier', 'Akanda'));
      expect(screen.getByRole('heading', { name: 'mangue-douce' })).toBeInTheDocument();
      expect(screen.getByText('Disponible · Akanda')).toBeInTheDocument();
      expect(screen.getByText('Plombier · Reçoit sur place')).toBeInTheDocument();
      expect(screen.getByText('à partir de 5 000 FCFA')).toBeInTheDocument();
      expect(screen.getByText('à partir de 10 000 FCFA')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Retour' })).toHaveAttribute(
        'href',
        '/mur/metier/Plombier?quartier=Akanda',
      );
    });

    it('Demander envoie la demande à lui seul puis revient à la liste avec le succès', async () => {
      afficher(cheminFichePrestataire('$p1', 'Plombier', 'Akanda'));
      fireEvent.click(await screen.findByRole('button', { name: 'Demander' }));
      expect(await screen.findByRole('heading', { name: 'Plombier · Akanda' })).toBeInTheDocument();
      expect(demanderA).toHaveBeenCalledWith(CLIENT, '@mangue:sia', {
        pseudo: 'moi-client',
        zone: 'Owendo',
      });
      expect(screen.getByRole('status')).toHaveTextContent('Demande envoyée à mangue-douce');
    });

    it('échec réseau : bandeau, on reste sur la fiche', async () => {
      vi.mocked(demanderA).mockRejectedValue(
        Object.assign(new Error('coupé'), { name: 'ConnectionError' }),
      );
      afficher(cheminFichePrestataire('$p1', 'Plombier'));
      fireEvent.click(await screen.findByRole('button', { name: 'Demander' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
      expect(screen.getByRole('heading', { name: 'mangue-douce' })).toBeInTheDocument();
    });

    it('un prestataire ne voit pas « Demander »', async () => {
      vi.mocked(lireProfil).mockResolvedValue(PROFIL_PRESTA);
      afficher(cheminFichePrestataire('$p1', 'Plombier'));
      await screen.findByText('Seuls les clients peuvent demander un service.');
      expect(screen.queryByRole('button', { name: 'Demander' })).not.toBeInTheDocument();
    });

    it('personne disparue : message et flèche retour', () => {
      afficher(cheminFichePrestataire('$inconnu', 'Plombier'));
      expect(screen.getByText("Cette personne n'est plus disponible.")).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Retour' })).toBeInTheDocument();
    });
  });

  describe('Fiche demande', () => {
    beforeEach(() => vi.mocked(lireProfil).mockResolvedValue(PROFIL_PRESTA));

    it('montre la demande ; « D’accord ? » dit oui puis revient à la liste avec le succès', async () => {
      afficher(cheminFicheDemande('$d1', 'Plombier', 'Akanda'));
      expect(screen.getByRole('heading', { name: 'palmier-48' })).toBeInTheDocument();
      expect(screen.getByText('Akanda · 5 000 FCFA · Plombier')).toBeInTheDocument();
      expect(screen.getByText("Fuite sous l'évier")).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: "D'accord ?" }));
      expect(await screen.findByRole('heading', { name: 'Plombier · Akanda' })).toBeInTheDocument();
      expect(direOui).toHaveBeenCalledWith(
        CLIENT,
        expect.objectContaining({ pseudo: 'palmier-48', budget: 5000, service: 'Plombier' }),
        '$d1',
        { pseudo: 'cocotier-7', zone: 'Akanda' },
      );
      expect(screen.getByRole('status')).toHaveTextContent('Réponse envoyée à palmier-48');
    });

    it('un client ne voit pas « D’accord ? »', async () => {
      vi.mocked(lireProfil).mockResolvedValue({ ok: true, profil: null });
      afficher(cheminFicheDemande('$d1', 'Plombier'));
      await waitFor(() => expect(lireProfilClient).toHaveBeenCalled());
      await act(async () => undefined);
      expect(screen.queryByRole('button', { name: "D'accord ?" })).not.toBeInTheDocument();
    });

    it('flèche retour vers la liste du métier', () => {
      afficher(cheminFicheDemande('$d1', 'Plombier', 'Akanda'));
      expect(screen.getByRole('link', { name: 'Retour' })).toHaveAttribute(
        'href',
        '/mur/metier/Plombier?quartier=Akanda',
      );
    });
  });

  describe('aides', () => {
    it('ilYa', () => {
      expect(ilYa(1000, 1000 + 20_000)).toBe("à l'instant");
      expect(ilYa(0, 12 * 60_000)).toBe('il y a 12 min');
      expect(ilYa(0, 3 * 3_600_000 + 5)).toBe('il y a 3 h');
    });

    it('lireSucces ne lit que du texte', () => {
      expect(lireSucces({ succes: 'ok' })).toBe('ok');
      expect(lireSucces({ succes: 3 })).toBeNull();
      expect(lireSucces(null)).toBeNull();
      expect(lireSucces({ succes: '' })).toBeNull();
    });
  });
});
