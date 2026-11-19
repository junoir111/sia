import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { CHEMINS, cheminBulle } from '../src/chemins';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { Bandeau } from '../src/ecrans/bandeau/Bandeau';
import { oublierReponses } from '../src/ecrans/bandeau/reponses';
import { lireDisponible } from '../src/appareil/disponible';
import { ecouterBulles, listerBulles } from '../src/matrix/bulles';
import type { ResumeBulle } from '../src/matrix/bulles';
import { demandesActives, ecouterDemandes, monStatutActif } from '../src/matrix/mur';
import type { DemandeRecue } from '../src/matrix/mur';
import { LigneOuvrir } from '../src/ui/LigneOuvrir';

// Jamais le vrai serveur : Mur, bulles et client Matrix sont simulés.
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/appareil/disponible', () => ({ lireDisponible: vi.fn() }));
vi.mock('../src/matrix/session', () => ({ lireSession: vi.fn(() => null) }));
vi.mock('../src/matrix/profil', () => ({ lireProfil: vi.fn() }));
vi.mock('../src/matrix/mur', () => ({
  ecouterDemandes: vi.fn(),
  demandesActives: vi.fn(),
  monStatutActif: vi.fn(),
}));
vi.mock('../src/matrix/bulles', () => ({
  ecouterBulles: vi.fn(),
  listerBulles: vi.fn(),
  direOui: vi.fn(),
  accepterOffre: vi.fn(),
  refuserOffre: vi.fn(),
}));

const CLIENT = { getUserId: () => '@mangue:sia' } as never;
const A = '!a:sia.tail94dc60.ts.net';
const B = '!b:sia.tail94dc60.ts.net';
const C = '!c:sia.tail94dc60.ts.net';
let bullesChangent: (b: ResumeBulle[]) => void = () => undefined;
let nouvelleDemande: (d: DemandeRecue) => void = () => undefined;

function bulle(roomId: string, o: Partial<ResumeBulle> = {}, pseudo = 'mangue-douce'): ResumeBulle {
  return {
    roomId,
    autre: { pseudo, zone: 'Owendo' },
    demande: null,
    etat: 'ouverte',
    nonLus: 0,
    autreEcrit: false,
    ...o,
  };
}

function demande(id: string, pseudo: string): DemandeRecue {
  const d = {
    pseudo,
    service: 'Plombier',
    zone: 'Akanda',
    texte: '',
    budget: 5000,
    fin: Date.now() + 3_600_000,
  };
  return { eventId: id, expediteur: '@client:sia', demande: d, contenu: { role: 'client', ...d } };
}

function EcranBulle() {
  const { roomId } = useParams();
  return <p>écran bulle {roomId}</p>;
}

/** Le bandeau au-dessus d'un petit appli : des liens pour changer d'écran comme le ferait l'utilisateur. */
function afficher(chemin = '/') {
  return render(
    <MemoryRouter initialEntries={[chemin]}>
      <Bandeau />
      <nav>
        <Link to={cheminBulle(A)}>vers A</Link>
        <Link to={cheminBulle(B)}>vers B</Link>
        <Link to="/">vers le mur</Link>
      </nav>
      <Routes>
        <Route path="/" element={<p>écran du dessous</p>} />
        <Route path={CHEMINS.bulle} element={<EcranBulle />} />
      </Routes>
    </MemoryRouter>,
  );
}

const cartes = () => screen.queryAllByRole('region');
const memoire = () =>
  JSON.parse(localStorage.getItem('sia.alertes') ?? '{}') as {
    ouvertures?: Record<string, string>;
    messages?: Record<string, number>;
  };
const lien = (nom: string) => screen.getByRole('link', { name: nom });
const ouvrir = (carte: HTMLElement = screen.getByRole('region')) =>
  fireEvent.click(within(carte).getByRole('button', { name: 'Ouvrir' }));

describe('Alertes de bulle dans le bandeau', () => {
  beforeEach(() => {
    localStorage.clear();
    oublierReponses();
    vi.mocked(useMatrix).mockReturnValue({ client: CLIENT, etat: 'pret' });
    vi.mocked(lireDisponible).mockReturnValue(false);
    vi.mocked(monStatutActif).mockReturnValue({
      eventId: '$statut',
      statut: { pseudo: 'mangue', metier: 'Plombier', zone: 'Owendo', fin: Date.now() + 60_000 },
    });
    vi.mocked(demandesActives).mockReset().mockResolvedValue([]);
    vi.mocked(ecouterDemandes).mockImplementation((_c, rappel) => {
      nouvelleDemande = rappel;
      return () => undefined;
    });
    vi.mocked(ecouterBulles).mockImplementation((_c, rappel) => {
      bullesChangent = rappel;
      return () => undefined;
    });
    vi.mocked(listerBulles).mockReset().mockReturnValue([]);
    Object.defineProperty(navigator, 'vibrate', { value: vi.fn(), configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  describe('« X a accepté. » : ma bulle passe de « en attente » à « ouverte »', () => {
    it('une carte avec le pseudo, « Ouvrir la bulle » et UN seul bouton « Ouvrir »', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' })]));
      expect(cartes()).toHaveLength(0);

      act(() => bullesChangent([bulle(A)]));
      const carte = screen.getByRole('region', { name: 'Bulle ouverte' });
      expect(within(carte).getByText('mangue-douce a accepté.')).toBeInTheDocument();
      expect(within(carte).getByText('Ouvrir la bulle')).toBeInTheDocument();
      expect(within(carte).getAllByRole('button')).toHaveLength(1);
      expect(within(carte).getByRole('button', { name: 'Ouvrir' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Oui' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Non' })).not.toBeInTheDocument();
      expect(navigator.vibrate).toHaveBeenCalledTimes(1);
    });

    it('même carte et mêmes animations que les autres : section de la pile, clé de glissement', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' })]));
      act(() => bullesChangent([bulle(A)]));
      const carte = screen.getByRole('region');
      expect(carte).toHaveClass('notif__carte');
      expect(carte).toHaveAttribute('data-glisse', `ouverte:${A}`);
      expect(carte.parentElement).toHaveClass('notif');
    });

    it('« Ouvrir » mène dans CETTE bulle, la carte s’en va et ne revient pas', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' }), bulle(B)]));
      act(() => bullesChangent([bulle(A), bulle(B)]));
      ouvrir();
      expect(screen.getByText(`écran bulle ${A}`)).toBeInTheDocument();
      expect(cartes()).toHaveLength(0);
      act(() => bullesChangent([bulle(A, { autreEcrit: true }), bulle(B)]));
      expect(cartes()).toHaveLength(0);
      expect(memoire().ouvertures).toEqual({ [A]: 'dite' });
    });

    it('elle disparaît dès que j’entre dans la bulle, même par un autre chemin que le bouton', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' })]));
      act(() => bullesChangent([bulle(A)]));
      expect(cartes()).toHaveLength(1);
      fireEvent.click(lien('vers A'));
      expect(cartes()).toHaveLength(0);
      fireEvent.click(lien('vers le mur'));
      expect(cartes()).toHaveLength(0);
    });

    it('elle reste tant que je n’y suis pas (autre bulle, autre écran), puis une seule fois par bulle', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' }), bulle(B)]));
      fireEvent.click(lien('vers B')); // dans une autre bulle
      act(() => bullesChangent([bulle(A), bulle(B)]));
      expect(screen.getByRole('region', { name: 'Bulle ouverte' })).toBeInTheDocument();
      act(() => bullesChangent([bulle(A, { autreEcrit: true }), bulle(B)]));
      expect(cartes()).toHaveLength(1);

      ouvrir();
      expect(cartes()).toHaveLength(0);
      // Elle repasse en attente puis ouverte : déjà dite, pas de seconde carte.
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' }), bulle(B)]));
      act(() => bullesChangent([bulle(A), bulle(B)]));
      fireEvent.click(lien('vers le mur'));
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' }), bulle(B)]));
      act(() => bullesChangent([bulle(A), bulle(B)]));
      expect(cartes()).toHaveLength(0);
    });

    it('j’étais déjà dans la bulle quand elle s’est ouverte : jamais de carte, même en sortant', () => {
      afficher(cheminBulle(A));
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' })]));
      act(() => bullesChangent([bulle(A)]));
      expect(cartes()).toHaveLength(0);
      vi.mocked(listerBulles).mockReturnValue([bulle(A)]);
      fireEvent.click(lien('vers le mur'));
      expect(cartes()).toHaveLength(0);
      expect(memoire().ouvertures).toEqual({ [A]: 'dite' });
    });

    it('une bulle déjà ouverte au départ (jamais vue en attente) : rien', () => {
      afficher();
      act(() => bullesChangent([bulle(A)]));
      expect(cartes()).toHaveLength(0);
    });

    it('l’autre est parti sans accepter : pas de carte', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' })]));
      act(() => bullesChangent([bulle(A, { etat: 'fermee' })]));
      expect(cartes()).toHaveLength(0);
    });

    it('rechargement : la carte pas encore traitée revient, celle déjà traitée ne revient jamais', () => {
      const premiere = afficher();
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' })]));
      act(() => bullesChangent([bulle(A)]));
      premiere.unmount(); // l'appli est fermée puis rouverte, sans avoir touché la carte

      const deuxieme = afficher();
      act(() => bullesChangent([bulle(A)]));
      expect(screen.getByText('mangue-douce a accepté.')).toBeInTheDocument();

      ouvrir();
      deuxieme.unmount(); // nouveau rechargement, alerte traitée

      afficher();
      act(() => bullesChangent([bulle(A)]));
      expect(cartes()).toHaveLength(0);
    });
  });

  describe('« Nouveau message de X » : un message arrive dans une bulle où je ne suis pas', () => {
    it('une carte « Nouveau message de X » avec « Ouvrir » ; jamais le texte du message', () => {
      afficher();
      act(() => bullesChangent([bulle(A)]));
      // Même si le texte voyageait avec la bulle, il ne doit jamais être posé à l'écran.
      const avecTexte = { ...bulle(A, { nonLus: 1 }), texte: 'rendez-vous à 18 h chez Paul' };
      act(() => bullesChangent([avecTexte as ResumeBulle]));

      const carte = screen.getByRole('region', { name: 'Nouveau message' });
      expect(within(carte).getByText('Nouveau message de mangue-douce')).toBeInTheDocument();
      expect(within(carte).getByText('Ouvrir la bulle')).toBeInTheDocument();
      expect(within(carte).getAllByRole('button')).toHaveLength(1);
      expect(within(carte).getByRole('button', { name: 'Ouvrir' })).toBeInTheDocument();
      expect(document.body.innerHTML).not.toMatch(/rendez-vous|18 h|Paul/);
      expect(carte).toHaveTextContent(/^Nouveau message de mangue-douceOuvrir la bulleOuvrir$/);
    });

    it('plusieurs messages de la même bulle : une seule carte, une seule vibration', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { nonLus: 1 })]));
      act(() => bullesChangent([bulle(A, { nonLus: 2 })]));
      act(() => bullesChangent([bulle(A, { nonLus: 5 })]));
      expect(cartes()).toHaveLength(1);
      expect(navigator.vibrate).toHaveBeenCalledTimes(1);
    });

    it('« Ouvrir » mène dans la bonne bulle (pas une autre) et la carte s’en va', () => {
      afficher();
      act(() => bullesChangent([bulle(A), bulle(B, { nonLus: 1 }, 'baobab-12')]));
      expect(screen.getByText('Nouveau message de baobab-12')).toBeInTheDocument();
      ouvrir();
      expect(screen.getByText(`écran bulle ${B}`)).toBeInTheDocument();
      expect(cartes()).toHaveLength(0);
    });

    it('elle s’efface dès que j’ouvre cette bulle, par n’importe quel chemin', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { nonLus: 1 })]));
      expect(cartes()).toHaveLength(1);
      fireEvent.click(lien('vers A'));
      expect(cartes()).toHaveLength(0);
    });

    it('autre écran ou autre bulle : la carte vient ; dans la bulle elle-même : jamais', () => {
      afficher();
      fireEvent.click(lien('vers B')); // je suis dans la bulle B
      act(() => bullesChangent([bulle(A), bulle(B)]));
      act(() => bullesChangent([bulle(A, { nonLus: 1 }), bulle(B, { nonLus: 1 }, 'baobab-12')]));
      expect(screen.getByText('Nouveau message de mangue-douce')).toBeInTheDocument();
      expect(screen.queryByText('Nouveau message de baobab-12')).not.toBeInTheDocument();
    });

    it('j’ai lu le message dans la bulle puis je sors : rien ne revient, le suivant refait une carte', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { nonLus: 1 })]));
      fireEvent.click(lien('vers A'));
      // Dans la bulle le message s'est affiché : la liste relue à la sortie ne le compte plus.
      vi.mocked(listerBulles).mockReturnValue([bulle(A)]);
      fireEvent.click(lien('vers le mur'));
      expect(cartes()).toHaveLength(0);
      act(() => bullesChangent([bulle(A, { nonLus: 1 })]));
      expect(screen.getByText('Nouveau message de mangue-douce')).toBeInTheDocument();
    });

    it('message que la bulle ne sait pas montrer : une fois la bulle ouverte, plus de carte (même après rechargement)', () => {
      const premiere = afficher();
      act(() => bullesChangent([bulle(A, { nonLus: 1 })]));
      fireEvent.click(lien('vers A'));
      vi.mocked(listerBulles).mockReturnValue([bulle(A, { nonLus: 1 })]); // toujours « non lu »
      fireEvent.click(lien('vers le mur'));
      expect(cartes()).toHaveLength(0);
      expect(memoire().messages).toEqual({ [A]: 1 });
      premiere.unmount();

      afficher();
      act(() => bullesChangent([bulle(A, { nonLus: 1 })]));
      expect(cartes()).toHaveLength(0);
      act(() => bullesChangent([bulle(A, { nonLus: 2 })])); // un vrai nouveau message
      expect(cartes()).toHaveLength(1);
    });

    it('rechargement : un message encore non lu refait sa carte au démarrage', () => {
      const premiere = afficher();
      act(() => bullesChangent([bulle(A, { nonLus: 2 })]));
      expect(cartes()).toHaveLength(1);
      premiere.unmount();
      afficher();
      act(() => bullesChangent([bulle(A, { nonLus: 2 })]));
      expect(screen.getByText('Nouveau message de mangue-douce')).toBeInTheDocument();
    });

    it('le message est effacé avant que je l’ouvre : la carte s’en va', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { nonLus: 1 })]));
      expect(cartes()).toHaveLength(1);
      act(() => bullesChangent([bulle(A, { nonLus: 0 })]));
      expect(cartes()).toHaveLength(0);
    });

    it('pas de carte pour une bulle en attente, fermée, ni pour une offre', () => {
      afficher();
      act(() =>
        bullesChangent([
          bulle(A, { etat: 'en-attente', nonLus: 1 }),
          bulle(B, { etat: 'fermee', nonLus: 1 }),
          bulle(C, { etat: 'invitation-recue', nonLus: 1 }),
        ]),
      );
      expect(screen.queryByRole('region', { name: 'Nouveau message' })).not.toBeInTheDocument();
    });
  });

  describe('la pile de trois cartes', () => {
    it('trois au plus, toutes sortes confondues ; la plus ancienne attend son tour', () => {
      afficher();
      act(() => nouvelleDemande(demande('$d1', 'palmier-48'))); // la plus ancienne
      act(() => bullesChangent([bulle(A, { nonLus: 1 }, 'ibis-3')]));
      act(() =>
        bullesChangent([bulle(A, { nonLus: 1 }, 'ibis-3'), bulle(B, { nonLus: 1 }, 'baobab-12')]),
      );
      act(() =>
        bullesChangent([
          bulle(A, { nonLus: 1 }, 'ibis-3'),
          bulle(B, { nonLus: 1 }, 'baobab-12'),
          bulle(C, { nonLus: 1 }, 'cocotier-7'),
        ]),
      );
      expect(cartes()).toHaveLength(3);
      expect(screen.queryByText(/palmier-48/)).not.toBeInTheDocument();
      // La plus récente en haut.
      expect(
        cartes().map((c) => /ibis-3|baobab-12|cocotier-7/.exec(c.textContent ?? '')?.[0]),
      ).toEqual(['cocotier-7', 'baobab-12', 'ibis-3']);

      // Une place se libère : la plus ancienne arrive, en bas de la pile.
      ouvrir(cartes()[0] as HTMLElement);
      const suite = cartes();
      expect(suite).toHaveLength(3);
      expect(within(suite[2] as HTMLElement).getByText(/palmier-48/)).toBeInTheDocument();
    });

    it('plusieurs cartes d’un coup : la bulle la plus active (première de la liste) en haut', () => {
      afficher();
      act(() =>
        bullesChangent([
          bulle(A, { nonLus: 1 }, 'ibis-3'),
          bulle(B, { nonLus: 1 }, 'baobab-12'),
          bulle(C, { nonLus: 1 }, 'cocotier-7'),
        ]),
      );
      expect(
        cartes().map((c) => /ibis-3|baobab-12|cocotier-7/.exec(c.textContent ?? '')?.[0]),
      ).toEqual(['ibis-3', 'baobab-12', 'cocotier-7']);
    });

    it('« a accepté » et « Nouveau message » de la même bulle : deux cartes, qui partent ensemble', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' })]));
      act(() => bullesChangent([bulle(A, { nonLus: 1 })]));
      expect(cartes()).toHaveLength(2);
      ouvrir(screen.getByRole('region', { name: 'Nouveau message' }));
      expect(screen.getByText(`écran bulle ${A}`)).toBeInTheDocument();
      expect(cartes()).toHaveLength(0);
    });

    it('les offres reçues ne sont pas touchées par les cartes de bulle', () => {
      afficher();
      const offre = bulle(C, { etat: 'invitation-recue' }, 'mangue-douce');
      act(() => bullesChangent([offre, bulle(A, { nonLus: 1 })]));
      expect(screen.getByText('Tu veux discuter ?')).toBeInTheDocument();
      expect(screen.getByText('Nouveau message de mangue-douce')).toBeInTheDocument();
      fireEvent.click(lien('vers A')); // j'entre dans la bulle A : la carte s'en va, l'offre reste
      expect(screen.getByText('Tu veux discuter ?')).toBeInTheDocument();
      expect(cartes()).toHaveLength(1);
    });
  });

  describe('ce que le téléphone garde', () => {
    it('seulement des identifiants de bulle et des nombres', () => {
      afficher();
      act(() => bullesChangent([bulle(A, { etat: 'en-attente' }), bulle(B, { nonLus: 3 })]));
      act(() => bullesChangent([bulle(A), bulle(B, { nonLus: 3 })]));
      expect(JSON.parse(localStorage.getItem('sia.alertes') ?? 'null')).toEqual({
        ouvertures: { [A]: 'attente' },
        messages: {},
      });
      fireEvent.click(lien('vers B'));
      vi.mocked(listerBulles).mockReturnValue([bulle(A), bulle(B, { nonLus: 3 })]);
      fireEvent.click(lien('vers le mur'));
      expect(memoire()).toEqual({ ouvertures: { [A]: 'attente' }, messages: { [B]: 3 } });
    });
  });
});

describe('LigneOuvrir', () => {
  it('« Ouvrir la bulle » et un seul bouton « Ouvrir »', () => {
    const surOuvrir = vi.fn();
    render(<LigneOuvrir onOuvrir={surOuvrir} />);
    expect(screen.getByText('Ouvrir la bulle')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(surOuvrir).toHaveBeenCalledTimes(1);
  });

  it('même mise en page que la ligne Non / Oui : même hauteur, même bouton plein de 48 px', () => {
    const { container } = render(<LigneOuvrir onOuvrir={vi.fn()} />);
    expect(container.firstElementChild).toHaveClass('reponse');
    expect(screen.getByRole('button')).toHaveClass('petit-bouton', 'petit-bouton--plein');
  });

  it('prend la classe de mise en page de l’écran qui l’emploie', () => {
    const { container } = render(<LigneOuvrir onOuvrir={vi.fn()} className="autre" />);
    expect(container.firstElementChild).toHaveClass('reponse', 'autre');
  });
});
