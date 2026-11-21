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
import { oublierMoi } from '../src/ecrans/mur/useMoi';
import { oublierMemoireMur } from '../src/ecrans/mur/useMur';
import { demanderA, direOui, listerBulles } from '../src/matrix/bulles';
import type { ResumeBulle } from '../src/matrix/bulles';
import { ecouterMur } from '../src/matrix/mur';
import { lireProfil, lireProfilClient } from '../src/matrix/profil';
import { lireSession } from '../src/matrix/session';
import { clientEcran, coupureReseau, differe } from './faux-ecran';

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

const FAUX = clientEcran();
const CLIENT = FAUX as never;
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

type Instantane = { statuts: unknown[]; demandes: unknown[] };
let changerMur: (m: Instantane) => void = () => undefined;

/** Le Mur lu une première fois, puis modifiable à la main (comme quand un événement arrive). */
function murVivant(statuts: unknown[] = STATUTS, demandes: unknown[] = DEMANDES) {
  vi.mocked(ecouterMur).mockImplementation(((_c: unknown, rappel: (m: Instantane) => void) => {
    changerMur = rappel;
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
        <Route path={CHEMINS.bulle} element={<p>écran bulle</p>} />
        <Route path={CHEMINS.accueil} element={<p>écran accueil</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const lieu = () => screen.getByTestId('lieu').textContent;

describe('Écrans du Mur', () => {
  beforeEach(() => {
    sessionStorage.clear();
    oublierMoi();
    oublierMemoireMur();
    FAUX.changerSynchro('SYNCING');
    vi.mocked(useMatrix).mockReturnValue({ client: CLIENT, etat: 'pret' });
    vi.mocked(lireSession).mockReturnValue(SESSION);
    vi.mocked(lireProfil).mockReset().mockResolvedValue({ ok: true, profil: null });
    vi.mocked(lireProfilClient).mockReset().mockResolvedValue(PROFIL_CLIENT);
    vi.mocked(demanderA).mockReset().mockResolvedValue({ roomId: '!bulle:sia', reutilisee: false });
    vi.mocked(direOui).mockReset().mockResolvedValue({ roomId: '!bulle:sia', reutilisee: false });
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

    it('un métier choisi montre les personnes de ce métier (pas une case)', () => {
      afficher(CHEMINS.mur);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'plomb' } });
      expect(screen.getByRole('heading', { name: 'Prestataires' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /mangue-douce/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /baobab-12/ })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Plombier/ })).not.toBeInTheDocument();
      expect(lieu()).toBe('/mur?q=plomb');
    });

    it('un métier après un quartier : les personnes de ce quartier, lien de fiche avec le quartier', () => {
      afficher(CHEMINS.mur);
      const champ = screen.getByRole('searchbox');
      fireEvent.change(champ, { target: { value: 'Akanda' } });
      fireEvent.change(champ, { target: { value: 'plomb' } });
      expect(lieu()).toBe('/mur?quartier=Akanda&q=plomb');
      // mangue-douce est à Akanda, baobab-12 à Owendo : seul le premier reste.
      expect(screen.getByRole('link', { name: /mangue-douce/ })).toHaveAttribute(
        'href',
        '/mur/prestataire/%24p1?quartier=Akanda',
      );
      expect(screen.queryByRole('link', { name: /baobab-12/ })).not.toBeInTheDocument();
    });

    it('reprend le métier tapé de l’adresse', () => {
      afficher('/mur?quartier=Akanda&q=plomb');
      expect(screen.getByRole('searchbox')).toHaveValue('plomb');
      expect(screen.getByRole('link', { name: /mangue-douce/ })).toBeInTheDocument();
    });

    it('retour par la flèche : texte tapé et position de défilement retrouvés', () => {
      const defiler = vi.fn();
      vi.stubGlobal('scrollTo', defiler);
      Object.defineProperty(window, 'scrollY', { value: 340, configurable: true });
      afficher(CHEMINS.mur);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'plomb' } });
      fireEvent.click(screen.getByRole('link', { name: /mangue-douce/ }));
      fireEvent.click(screen.getByRole('link', { name: 'Retour' }));
      expect(screen.getByRole('searchbox')).toHaveValue('plomb');
      expect(defiler).toHaveBeenLastCalledWith(0, 340);
      vi.unstubAllGlobals();
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    });

    it('les puces de métier filtrent : « Plombier » montre les personnes, « Tout » rend la grille', () => {
      afficher(CHEMINS.mur);
      const puces = screen.getByRole('group', { name: 'Filtrer par métier' });
      fireEvent.click(within(puces).getByRole('button', { name: 'Plombier' }));
      expect(screen.getByRole('link', { name: /mangue-douce/ })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Plombier/ })).not.toBeInTheDocument();
      fireEvent.click(within(puces).getByRole('button', { name: 'Tout' }));
      expect(screen.getByRole('link', { name: /Plombier/ })).toBeInTheDocument();
    });

    it('la cloche mène aux bulles ; une pastille quand il y a du nouveau', () => {
      afficher(CHEMINS.mur);
      expect(screen.getByRole('link', { name: 'Mes bulles' })).toHaveAttribute(
        'href',
        CHEMINS.bulles,
      );
    });

    it('cloche : le libellé dit le nombre de nouveautés', () => {
      const bulle: ResumeBulle = {
        roomId: '!b:sia',
        autre: { pseudo: 'x', zone: 'y' },
        demande: null,
        etat: 'ouverte',
        nonLus: 3,
        autreEcrit: false,
      };
      vi.mocked(listerBulles).mockReturnValue([bulle]);
      afficher(CHEMINS.mur);
      expect(screen.getByRole('link', { name: /Mes bulles, 3 nouveau/ })).toBeInTheDocument();
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
      expect(
        within(screen.getByRole('link', { name: /Plombier/ })).getByText('1 dispo'),
      ).toBeInTheDocument();
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

    it('prestataire : la demande d’un client est dans la section « Clients » et ouvre sa fiche', async () => {
      vi.mocked(lireProfil).mockResolvedValue(PROFIL_PRESTA);
      afficher(CHEMINS.mur);
      await screen.findByRole('link', { name: 'Je suis disponible' });
      const clients = screen.getByRole('region', { name: 'Demandes des clients' });
      const carte = within(clients).getByRole('link', { name: /palmier-48/ });
      expect(carte).toHaveTextContent("Fuite sous l'évier");
      expect(carte).toHaveAttribute('href', '/mur/demande/%24d1');
      fireEvent.click(carte);
      expect(await screen.findByRole('button', { name: /D'accord/ })).toBeInTheDocument();
    });

    it('client : aucune section « Clients » (il ne voit pas les demandes des autres)', async () => {
      afficher(CHEMINS.mur);
      await screen.findByRole('link', { name: 'Publier une demande' });
      expect(
        screen.queryByRole('region', { name: 'Demandes des clients' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('palmier-48')).not.toBeInTheDocument();
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
      // « Mes clients » est réservé aux prestataires.
      expect(within(panneau).queryByRole('link', { name: /Mes clients/ })).not.toBeInTheDocument();
      fireEvent.click(within(panneau).getByRole('button', { name: 'Fermer' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('Mon compte : un prestataire a le lien « Mes clients »', async () => {
      vi.mocked(lireProfil).mockResolvedValue(PROFIL_PRESTA);
      afficher(CHEMINS.mur);
      await screen.findByRole('link', { name: 'Je suis disponible' });
      fireEvent.click(screen.getByRole('button', { name: 'Mon compte' }));
      const panneau = screen.getByRole('dialog');
      expect(within(panneau).getByRole('link', { name: /Mes clients/ })).toHaveAttribute(
        'href',
        CHEMINS.clients,
      );
    });

    it('sans réseau : bandeau qui dit quoi faire', () => {
      vi.mocked(useMatrix).mockReturnValue({ client: null, etat: 'erreur-reseau' });
      afficher(CHEMINS.mur);
      expect(screen.getByRole('alert')).toHaveTextContent('Pas de réseau.');
    });

    describe('liste vivante', () => {
      it('un prestataire qui arrive s’affiche seul : le chiffre monte, sans rien toucher', () => {
        murVivant();
        afficher(CHEMINS.mur);
        expect(
          within(screen.getByRole('link', { name: /Plombier/ })).getByText('2 dispo'),
        ).toBeInTheDocument();
        const nouveau = {
          eventId: '$p3',
          userId: '@neuf:sia',
          pseudo: 'neuf-3',
          metier: 'Plombier',
          zone: 'Akanda',
          fin: PLUS_TARD,
        };
        act(() => changerMur({ statuts: [...STATUTS, nouveau], demandes: DEMANDES }));
        expect(
          within(screen.getByRole('link', { name: /Plombier/ })).getByText('3 dispo'),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: /actualiser|recharger/i }),
        ).not.toBeInTheDocument();
      });

      it('un nouveau métier apparaît en place : les cases déjà là gardent leur élément', () => {
        murVivant();
        afficher(CHEMINS.mur);
        const plombier = screen.getByRole('link', { name: /Plombier/ });
        const coiffeuse = {
          eventId: '$p4',
          userId: '@coif:sia',
          pseudo: 'coif-4',
          metier: 'Coiffeuse',
          zone: 'Akanda',
          fin: PLUS_TARD,
        };
        act(() => changerMur({ statuts: [...STATUTS, coiffeuse], demandes: DEMANDES }));
        expect(screen.getByRole('link', { name: /Coiffeuse/ })).toBeInTheDocument();
        // Même élément dans la page (pas reconstruit) : rien ne clignote.
        expect(screen.getByRole('link', { name: /Plombier/ })).toBe(plombier);
      });

      it('chaque case porte sa clé : la liste peut glisser au lieu de sauter', () => {
        afficher(CHEMINS.mur);
        const case1 = screen.getAllByRole('listitem')[0];
        expect(case1).toHaveAttribute('data-glisse', 'Plombier');
      });

      it('« Mise à jour… » pendant que le client rattrape ses événements, puis plus rien', () => {
        afficher(CHEMINS.mur);
        expect(screen.queryByText('Mise à jour…')).not.toBeInTheDocument();
        act(() => FAUX.changerSynchro('CATCHUP'));
        expect(screen.getByText('Mise à jour…')).toBeInTheDocument();
        // La grille reste là pendant la mise à jour : jamais d'écran vide ou de « Chargement… ».
        expect(screen.getByRole('link', { name: /Plombier/ })).toBeInTheDocument();
        act(() => FAUX.changerSynchro('SYNCING'));
        expect(screen.queryByText('Mise à jour…')).not.toBeInTheDocument();
      });

      it('l’écran suivant s’affiche tout de suite avec ce que le Mur a déjà lu (pas de « Chargement… »)', () => {
        // Première lecture au Mur ; ensuite le serveur met du temps à répondre (aucun rappel).
        let appels = 0;
        vi.mocked(ecouterMur).mockImplementation(((
          _c: unknown,
          rappel: (m: Instantane) => void,
        ) => {
          appels += 1;
          if (appels === 1) rappel({ statuts: STATUTS, demandes: DEMANDES });
          return () => undefined;
        }) as never);
        afficher(CHEMINS.mur);
        fireEvent.click(screen.getByRole('link', { name: /Plombier/ }));
        expect(
          screen.getByRole('heading', { name: 'Disponibles maintenant · 2' }),
        ).toBeInTheDocument();
        expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
        // Et la fiche, au pas suivant, aussi.
        fireEvent.click(screen.getByRole('link', { name: /mangue-douce/ }));
        expect(screen.getByRole('heading', { name: 'mangue-douce' })).toBeInTheDocument();
      });

      it('première lecture pas finie : « Chargement… » une seule fois, jamais ensuite', () => {
        vi.mocked(ecouterMur).mockImplementation((() => () => undefined) as never);
        afficher(CHEMINS.mur);
        expect(screen.getByText('Chargement…')).toBeInTheDocument();
      });
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

    it('bulle déjà ouverte avec lui : Demander mène directement dans cette bulle', async () => {
      vi.mocked(demanderA).mockResolvedValue({ roomId: '!vieille:sia', reutilisee: true });
      afficher(cheminFichePrestataire('$p1', 'Plombier', 'Akanda'));
      fireEvent.click(await screen.findByRole('button', { name: 'Demander' }));
      expect(await screen.findByText('écran bulle')).toBeInTheDocument();
      expect(lieu()).toBe('/bulle/!vieille%3Asia');
    });

    it('échec réseau : bandeau, on reste sur la fiche', async () => {
      vi.mocked(demanderA).mockRejectedValue(
        Object.assign(new Error('coupé'), { name: 'ConnectionError' }),
      );
      afficher(cheminFichePrestataire('$p1', 'Plombier'));
      fireEvent.click(await screen.findByRole('button', { name: 'Demander' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Pas de réseau.');
      expect(screen.getByRole('heading', { name: 'mangue-douce' })).toBeInTheDocument();
    });

    describe('retour immédiat au toucher', () => {
      it('Demander : le bouton dit « Demande envoyée… » tout de suite ; la liste vient quand le serveur confirme', async () => {
        const serveur = differe<{ roomId: string; reutilisee: boolean }>();
        vi.mocked(demanderA).mockReturnValue(serveur.promesse);
        afficher(cheminFichePrestataire('$p1', 'Plombier', 'Akanda'));
        fireEvent.click(await screen.findByRole('button', { name: 'Demander' }));

        // Le serveur n'a pas répondu : l'écran a déjà changé, on reste sur la fiche.
        const bouton = screen.getByRole('button', { name: 'Demande envoyée…' });
        expect(bouton).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Demander' })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'mangue-douce' })).toBeInTheDocument();

        await act(async () => serveur.resoudre({ roomId: '!bulle:sia', reutilisee: false }));
        expect(
          await screen.findByRole('heading', { name: 'Plombier · Akanda' }),
        ).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Demande envoyée à mangue-douce');
      });

      it('Demander : pas de double toucher, une seule demande part', async () => {
        const serveur = differe<{ roomId: string; reutilisee: boolean }>();
        vi.mocked(demanderA).mockReturnValue(serveur.promesse);
        afficher(cheminFichePrestataire('$p1', 'Plombier', 'Akanda'));
        const bouton = await screen.findByRole('button', { name: 'Demander' });
        fireEvent.click(bouton);
        fireEvent.click(bouton);
        expect(demanderA).toHaveBeenCalledTimes(1);
        await act(async () => serveur.resoudre({ roomId: '!bulle:sia', reutilisee: false }));
      });

      it('Demander : le serveur refuse (pas de réseau) : message, et le bouton redevient actif', async () => {
        const serveur = differe<{ roomId: string; reutilisee: boolean }>();
        vi.mocked(demanderA).mockReturnValueOnce(serveur.promesse);
        afficher(cheminFichePrestataire('$p1', 'Plombier', 'Akanda'));
        fireEvent.click(await screen.findByRole('button', { name: 'Demander' }));
        expect(screen.getByRole('button', { name: 'Demande envoyée…' })).toBeDisabled();

        await act(async () => serveur.rejeter(coupureReseau()));
        expect(screen.getByRole('alert')).toHaveTextContent('Pas de réseau.');
        expect(screen.getByRole('button', { name: 'Demander' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Demande envoyée…' })).not.toBeInTheDocument();

        // On peut réessayer.
        fireEvent.click(screen.getByRole('button', { name: 'Demander' }));
        expect(
          await screen.findByRole('heading', { name: 'Plombier · Akanda' }),
        ).toBeInTheDocument();
        expect(demanderA).toHaveBeenCalledTimes(2);
      });

      it('autre refus du serveur : message, bouton rendu', async () => {
        vi.mocked(demanderA).mockRejectedValue(new Error('Prestataire indisponible.'));
        afficher(cheminFichePrestataire('$p1', 'Plombier'));
        fireEvent.click(await screen.findByRole('button', { name: 'Demander' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Ça n’a pas marché.');
        expect(screen.getByRole('button', { name: 'Demander' })).toBeEnabled();
      });

      it('on a quitté la fiche pendant l’envoi : la confirmation ne ramène personne en arrière', async () => {
        const serveur = differe<{ roomId: string; reutilisee: boolean }>();
        vi.mocked(demanderA).mockReturnValue(serveur.promesse);
        afficher(cheminFichePrestataire('$p1', 'Plombier', 'Akanda'));
        fireEvent.click(await screen.findByRole('button', { name: 'Demander' }));
        fireEvent.click(screen.getByRole('link', { name: 'Retour' }));
        expect(
          await screen.findByRole('heading', { name: 'Plombier · Akanda' }),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('link', { name: 'Retour' }));
        expect(screen.getByRole('heading', { name: 'Le Mur' })).toBeInTheDocument();

        await act(async () => serveur.resoudre({ roomId: '!bulle:sia', reutilisee: false }));
        expect(screen.getByRole('heading', { name: 'Le Mur' })).toBeInTheDocument();
      });

      it('« Demander » est là dès l’ouverture de la fiche quand le profil est déjà connu', async () => {
        // Passage par le Mur : le profil est lu une fois.
        afficher(CHEMINS.mur);
        await screen.findByRole('link', { name: 'Publier une demande' });
        fireEvent.click(screen.getByRole('link', { name: /Plombier/ }));
        // Le serveur ne répond plus : la fiche, elle, a déjà ce qu'il faut.
        vi.mocked(lireProfil).mockReturnValue(new Promise(() => undefined));
        fireEvent.click(screen.getByRole('link', { name: /mangue-douce/ }));
        expect(screen.getByRole('button', { name: 'Demander' })).toBeEnabled();
      });
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

    it('bulle déjà ouverte avec ce client : « D’accord ? » mène dans cette bulle', async () => {
      vi.mocked(direOui).mockResolvedValue({ roomId: '!vieille:sia', reutilisee: true });
      afficher(cheminFicheDemande('$d1', 'Plombier', 'Akanda'));
      fireEvent.click(await screen.findByRole('button', { name: "D'accord ?" }));
      expect(await screen.findByText('écran bulle')).toBeInTheDocument();
    });

    describe('retour immédiat au toucher', () => {
      it('« D’accord ? » : le bouton dit « Réponse envoyée… » tout de suite ; la liste vient quand le serveur confirme', async () => {
        const serveur = differe<{ roomId: string; reutilisee: boolean }>();
        vi.mocked(direOui).mockReturnValue(serveur.promesse);
        afficher(cheminFicheDemande('$d1', 'Plombier', 'Akanda'));
        fireEvent.click(await screen.findByRole('button', { name: "D'accord ?" }));

        expect(screen.getByRole('button', { name: 'Réponse envoyée…' })).toBeDisabled();
        expect(screen.getByRole('heading', { name: 'palmier-48' })).toBeInTheDocument();

        await act(async () => serveur.resoudre({ roomId: '!bulle:sia', reutilisee: false }));
        expect(
          await screen.findByRole('heading', { name: 'Plombier · Akanda' }),
        ).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Réponse envoyée à palmier-48');
      });

      it('le serveur refuse (pas de réseau) : message, et le bouton redevient actif', async () => {
        const serveur = differe<{ roomId: string; reutilisee: boolean }>();
        vi.mocked(direOui).mockReturnValueOnce(serveur.promesse);
        afficher(cheminFicheDemande('$d1', 'Plombier', 'Akanda'));
        fireEvent.click(await screen.findByRole('button', { name: "D'accord ?" }));
        await act(async () => serveur.rejeter(coupureReseau()));
        expect(screen.getByRole('alert')).toHaveTextContent('Pas de réseau.');
        expect(screen.getByRole('button', { name: "D'accord ?" })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Réponse envoyée…' })).not.toBeInTheDocument();
      });
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
