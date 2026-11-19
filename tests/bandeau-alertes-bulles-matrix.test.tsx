import type { MatrixEvent } from 'matrix-js-sdk';
import { RoomEvent, RoomMemberEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS, cheminBulle } from '../src/chemins';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { Bandeau } from '../src/ecrans/bandeau/Bandeau';
import { oublierReponses } from '../src/ecrans/bandeau/reponses';
import { lireDisponible } from '../src/appareil/disponible';
import { arreterEphemere, marquerAffiche } from '../src/matrix/ephemere';
import { oublierMur } from '../src/matrix/mur';
import { AUTRE, MOI, comme, evenement, fauxClient, salon } from './faux-matrix';
import type { FauxSalon } from './faux-matrix';

/*
 * La chaîne complète : le VRAI ecouterBulles / listerBulles (src/matrix/bulles.ts) sur un faux client Matrix,
 * avec le vrai bandeau. Ici rien n'est fabriqué à la main : c'est la salle Matrix qui change (l'autre rejoint,
 * un message arrive) et le bandeau doit suivre. Aucun réseau.
 */
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/appareil/disponible', () => ({ lireDisponible: vi.fn() }));
vi.mock('../src/matrix/session', () => ({ lireSession: vi.fn(() => null) }));
vi.mock('../src/matrix/profil', () => ({ lireProfil: vi.fn() }));
vi.mock('../src/matrix/mur', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/matrix/mur')>()),
  ecouterDemandes: vi.fn(() => () => undefined),
  demandesActives: vi.fn(async () => []),
  monStatutActif: vi.fn(() => null),
}));

const BULLE = '!b1:sia.tail94dc60.ts.net';
const ETAT_BULLE = {
  demande: { annonce: '$dem', service: 'Plombier', zone: 'Akanda', budget: 5000, texte: 'Fuite' },
  participants: {
    [MOI]: { pseudo: 'puma', zone: 'Nzeng' },
    [AUTRE]: { pseudo: 'palmier-48', zone: 'Akanda' },
  },
};

/** Bulle chiffrée créée par moi (le prestataire qui a dit oui) : l'autre, invité, n'a pas encore accepté. */
function bulleEnAttente(): FauxSalon {
  const invitation = evenement({
    type: 'm.room.member',
    stateKey: AUTRE,
    sender: MOI,
    roomId: BULLE,
    content: { membership: 'invite' },
  });
  const etat: Record<string, MatrixEvent> = {
    'm.room.encryption': evenement({
      type: 'm.room.encryption',
      stateKey: '',
      content: { algorithm: 'm.megolm.v1.aes-sha2' },
    }),
    'io.sia.bulle': evenement({
      type: 'io.sia.bulle',
      stateKey: '',
      sender: MOI,
      content: ETAT_BULLE as Record<string, unknown>,
    }),
  };
  return {
    roomId: BULLE,
    appartenance: 'join',
    createur: MOI,
    membres: {
      [MOI]: { membership: 'join' },
      [AUTRE]: { membership: 'invite', event: invitation },
    },
    etat,
    evenements: [],
  };
}

let message = 0;
function messageDeLAutre(texte: string): MatrixEvent {
  message += 1;
  return evenement({
    type: 'm.room.message',
    sender: AUTRE,
    roomId: BULLE,
    id: `$message${message}`,
    content: { body: texte },
  });
}

let f: FauxSalon;
let c: ReturnType<typeof fauxClient>;

function afficher() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Bandeau />
      <nav>
        <Link to={cheminBulle(BULLE)}>vers la bulle</Link>
        <Link to="/">vers le mur</Link>
      </nav>
      <Routes>
        <Route path="/" element={<p>écran du dessous</p>} />
        <Route path={CHEMINS.bulle} element={<p>écran bulle</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Laisse passer le regroupement de 50 ms d'ecouterBulles, puis ce qui tourne en arrière-plan. */
async function laisserPasser(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(80);
  });
}

/** Le serveur change la salle : on prévient le client comme le ferait le SDK. */
async function surLeSdk(evenementSdk: string, modifier: () => void): Promise<void> {
  modifier();
  c.emit(evenementSdk);
  await laisserPasser();
}

const cartes = () => screen.queryAllByRole('region');

describe('alertes de bulle avec le vrai suivi des bulles (faux client Matrix)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    localStorage.clear();
    oublierMur();
    oublierReponses();
    f = bulleEnAttente();
    c = fauxClient([salon(f)]);
    vi.mocked(useMatrix).mockReturnValue({ client: comme(c), etat: 'pret' });
    vi.mocked(lireDisponible).mockReturnValue(false);
    Object.defineProperty(navigator, 'vibrate', { value: vi.fn(), configurable: true });
  });

  afterEach(() => {
    arreterEphemere();
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('l’autre accepte : « palmier-48 a accepté. » ; Ouvrir mène dans la bulle et la carte ne revient pas', async () => {
    afficher();
    await laisserPasser();
    expect(cartes()).toHaveLength(0); // en attente : rien à dire

    await surLeSdk(RoomMemberEvent.Membership, () => {
      f.membres[AUTRE] = { membership: 'join' };
    });
    expect(screen.getByText('palmier-48 a accepté.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(screen.getByText('écran bulle')).toBeInTheDocument();
    expect(cartes()).toHaveLength(0);

    // La bulle bouge encore (l'autre écrit) : toujours rien, une fois dite.
    await surLeSdk(RoomMemberEvent.Typing, () => {
      f.membres[AUTRE] = { membership: 'join', typing: true };
    });
    fireEvent.click(screen.getByRole('link', { name: 'vers le mur' }));
    await laisserPasser();
    expect(cartes()).toHaveLength(0);
  });

  it('bulle ouverte : un message de l’autre fait UNE carte (même à plusieurs messages), sans son texte', async () => {
    f.membres[AUTRE] = { membership: 'join' }; // déjà ouverte, rien à annoncer
    afficher();
    await laisserPasser();
    expect(cartes()).toHaveLength(0);

    await surLeSdk(RoomEvent.Timeline, () => {
      f.evenements.push(messageDeLAutre('on se retrouve à 18 h'));
    });
    expect(screen.getByText('Nouveau message de palmier-48')).toBeInTheDocument();
    await surLeSdk(RoomEvent.Timeline, () => {
      f.evenements.push(messageDeLAutre('chez Paul'));
      f.evenements.push(messageDeLAutre('apporte les clés'));
    });
    expect(cartes()).toHaveLength(1);
    expect(document.body.innerHTML).not.toMatch(/18 h|Paul|clés/);
    expect(navigator.vibrate).toHaveBeenCalledTimes(1);
  });

  it('j’entre, je lis (le message est affiché), je sors : plus rien ; le message suivant refait une carte', async () => {
    f.membres[AUTRE] = { membership: 'join' };
    afficher();
    await laisserPasser();
    const premier = messageDeLAutre('premier');
    await surLeSdk(RoomEvent.Timeline, () => {
      f.evenements.push(premier);
    });
    expect(cartes()).toHaveLength(1);

    fireEvent.click(screen.getByRole('link', { name: 'vers la bulle' }));
    expect(cartes()).toHaveLength(0);
    // L'écran de la bulle affiche le message : il compte comme lu (et part dans une minute).
    marquerAffiche(comme(c), BULLE, premier.getId() ?? '');

    fireEvent.click(screen.getByRole('link', { name: 'vers le mur' }));
    await laisserPasser();
    expect(cartes()).toHaveLength(0);

    await surLeSdk(RoomEvent.Timeline, () => {
      f.evenements.push(messageDeLAutre('second'));
    });
    expect(screen.getByText('Nouveau message de palmier-48')).toBeInTheDocument();
  });

  it('un message arrive pendant que je suis DANS la bulle : jamais de carte', async () => {
    f.membres[AUTRE] = { membership: 'join' };
    afficher();
    await laisserPasser();
    fireEvent.click(screen.getByRole('link', { name: 'vers la bulle' }));
    await surLeSdk(RoomEvent.Timeline, () => {
      f.evenements.push(messageDeLAutre('pendant que tu lis'));
    });
    expect(cartes()).toHaveLength(0);
  });

  it('rechargement : une carte « a accepté » encore pas ouverte revient, une fois ouverte elle ne revient plus', async () => {
    const premiere = afficher();
    await laisserPasser();
    await surLeSdk(RoomMemberEvent.Membership, () => {
      f.membres[AUTRE] = { membership: 'join' };
    });
    expect(cartes()).toHaveLength(1);
    premiere.unmount(); // l'appli est rechargée sans que la carte ait été touchée

    const deuxieme = afficher();
    await laisserPasser();
    expect(screen.getByText('palmier-48 a accepté.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    deuxieme.unmount();

    afficher();
    await laisserPasser();
    expect(cartes()).toHaveLength(0);
  });
});
