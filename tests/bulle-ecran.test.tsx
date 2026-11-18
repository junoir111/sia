import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS, cheminBulle } from '../src/chemins';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { Bulle } from '../src/ecrans/bulle/Bulle';
import { pseudoDe } from '../src/matrix/annuaire';
import {
  ErreurEnvoiBulle,
  accepterNouvelAppareil,
  bulleSaine,
  envoyerMessage,
  listerBulles,
  signalerEcriture,
  silenceRadio,
} from '../src/matrix/bulles';
import type { ResumeBulle } from '../src/matrix/bulles';
import { marquerAffiche } from '../src/matrix/ephemere';

// Jamais le vrai serveur : le client Matrix, les bulles et l'effacement sont simulés.
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/matrix/ephemere', () => ({
  marquerAffiche: vi.fn(),
  echeanceEffacement: vi.fn(() => null),
}));
vi.mock('../src/matrix/annuaire', () => ({ pseudoDe: vi.fn() }));
vi.mock('../src/matrix/bulles', () => ({
  ErreurEnvoiBulle: class ErreurEnvoiBulle extends Error {
    readonly code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  LONGUEUR_MAX_MESSAGE: 1000,
  accepterNouvelAppareil: vi.fn(),
  bulleSaine: vi.fn(),
  ecouterBulles: vi.fn(() => () => undefined),
  listerBulles: vi.fn(),
  envoyerMessage: vi.fn(),
  signalerEcriture: vi.fn(),
  silenceRadio: vi.fn(),
}));

const MOI = '@moi:sia';
const SALON = '!bulle:sia';
const AUTRE = '@autre:sia';

type FauxEv = {
  id: string;
  type?: string;
  body: string;
  sender: string;
  efface?: boolean;
  enClair?: boolean;
  illisible?: boolean;
};

const ETAT_BULLE = {
  demande: { annonce: '$d', service: 'Plombier', zone: 'Akanda', budget: 5000, texte: '' },
  participants: {
    [MOI]: { pseudo: 'puma', zone: 'Nzeng' },
    [AUTRE]: { pseudo: 'palmier-48', zone: 'Akanda' },
  },
};

function fauxEvenement(e: FauxEv) {
  return {
    getId: () => e.id,
    getType: () => e.type ?? 'm.room.message',
    getContent: () => ({ msgtype: 'm.text', body: e.body }),
    getSender: () => e.sender,
    getRoomId: () => SALON,
    isRedacted: () => e.efface === true,
    isState: () => false,
    isEncrypted: () => e.enClair !== true,
    isDecryptionFailure: () => e.illisible === true,
  };
}

function fauxClient(evenements: FauxEv[]) {
  const evs = evenements.map(fauxEvenement);
  return {
    getUserId: () => MOI,
    getRoom: (id: string) =>
      id === SALON
        ? {
            getLiveTimeline: () => ({ getEvents: () => evs }),
            currentState: {
              getStateEvents: (type: string) =>
                type === 'io.sia.bulle' ? { getContent: () => ETAT_BULLE } : null,
            },
          }
        : null,
    on: vi.fn(),
    off: vi.fn(),
  } as never;
}

function resume(o: Partial<ResumeBulle> = {}): ResumeBulle {
  return {
    roomId: SALON,
    autre: { pseudo: 'palmier-48', zone: 'Akanda' },
    demande: {
      annonce: '$d',
      service: 'Plombier',
      zone: 'Akanda',
      budget: 5000,
      texte: "Fuite sous l'évier, ce soir",
    },
    etat: 'ouverte',
    nonLus: 0,
    autreEcrit: false,
    ...o,
  };
}

let client = fauxClient([]);

function afficher() {
  render(
    <MemoryRouter initialEntries={[cheminBulle(SALON)]}>
      <Routes>
        <Route path={CHEMINS.bulle} element={<Bulle />} />
        <Route path={CHEMINS.bulles} element={<p>écran bulles</p>} />
        <Route path={CHEMINS.mur} element={<p>écran mur</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const champ = () => screen.getByRole('textbox', { name: 'Écris un message' });

describe('Écran Bulle (M4)', () => {
  beforeEach(() => {
    client = fauxClient([
      { id: '$m1', body: 'Bonsoir. Je peux venir pour 7 000.', sender: MOI },
      { id: '$m2', body: '6 000 ?', sender: AUTRE },
      { id: '$m3', body: 'effacé', sender: AUTRE, efface: true },
      { id: '$m5', body: 'en clair', sender: AUTRE, enClair: true },
      { id: '$m6', body: 'intrus', sender: '@intrus:sia' },
      { id: '$m7', body: 'illisible', sender: AUTRE, illisible: true },
    ]);
    vi.mocked(useMatrix).mockReturnValue({ client, etat: 'pret' });
    vi.mocked(listerBulles).mockReset().mockReturnValue([resume()]);
    vi.mocked(envoyerMessage).mockReset().mockResolvedValue('$m4');
    vi.mocked(signalerEcriture).mockReset().mockResolvedValue(undefined);
    vi.mocked(silenceRadio).mockReset().mockResolvedValue(undefined);
    vi.mocked(marquerAffiche).mockReset();
    vi.mocked(bulleSaine).mockReset().mockReturnValue(true);
    vi.mocked(accepterNouvelAppareil).mockReset().mockResolvedValue(undefined);
    vi.mocked(pseudoDe).mockReset().mockReturnValue(null);
  });

  it('en-tête, la demande, le rappel et les messages (effacés cachés)', () => {
    afficher();
    expect(screen.getByRole('heading', { name: 'palmier-48' })).toBeInTheDocument();
    expect(screen.getByText(/Plombier · Akanda · 5\s000 FCFA/)).toBeInTheDocument();
    expect(screen.getByText("Fuite sous l'évier, ce soir")).toBeInTheDocument();
    expect(screen.getByText("Chaque message s'efface 1 minute après lecture.")).toBeInTheDocument();
    expect(screen.getByText('Bonsoir. Je peux venir pour 7 000.')).toBeInTheDocument();
    expect(screen.getByText('6 000 ?')).toBeInTheDocument();
    expect(screen.queryByText('effacé')).not.toBeInTheDocument();
  });

  it('ignore les messages en clair, d’un intrus ou mal déchiffrés', () => {
    afficher();
    expect(screen.queryByText('en clair')).not.toBeInTheDocument();
    expect(screen.queryByText('intrus')).not.toBeInTheDocument();
    expect(screen.queryByText('illisible')).not.toBeInTheDocument();
    expect(marquerAffiche).not.toHaveBeenCalledWith(client, SALON, '$m5');
    expect(marquerAffiche).not.toHaveBeenCalledWith(client, SALON, '$m6');
  });

  it('le pseudo de l’autre vient de l’annuaire', () => {
    vi.mocked(pseudoDe).mockReturnValue('baobab-7');
    afficher();
    expect(pseudoDe).toHaveBeenCalledWith(AUTRE);
    expect(screen.getByRole('heading', { name: 'baobab-7' })).toBeInTheDocument();
  });

  it('bulle pas sûre : aucun message, alerte, puis retour au Mur', async () => {
    vi.mocked(bulleSaine).mockReturnValue(false);
    afficher();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Cette bulle n'est pas sûre. Elle a été fermée.",
    );
    expect(screen.queryByText('6 000 ?')).not.toBeInTheDocument();
    expect(marquerAffiche).not.toHaveBeenCalled();
    expect(champ()).toBeDisabled();
    expect(await screen.findByText('écran mur', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('nouvel appareil : confirmation, Continuer accepte puis renvoie', async () => {
    vi.mocked(envoyerMessage)
      .mockRejectedValueOnce(new ErreurEnvoiBulle('nouvel-appareil'))
      .mockResolvedValueOnce('$m8');
    afficher();
    fireEvent.change(champ(), { target: { value: 'Salut' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    const panneau = await screen.findByRole('dialog', { name: 'Nouvel appareil' });
    expect(panneau).toHaveTextContent(
      "L'autre personne utilise un nouvel appareil. Continue seulement si tu lui fais confiance.",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await vi.waitFor(() => expect(champ()).toHaveValue(''));
    expect(accepterNouvelAppareil).toHaveBeenCalledWith(client, SALON);
    expect(envoyerMessage).toHaveBeenCalledTimes(2);
    expect(envoyerMessage).toHaveBeenLastCalledWith(client, SALON, 'Salut');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('nouvel appareil annulé : rien n’est accepté, le texte reste', async () => {
    vi.mocked(envoyerMessage).mockRejectedValueOnce(new ErreurEnvoiBulle('nouvel-appareil'));
    afficher();
    fireEvent.change(champ(), { target: { value: 'Salut' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    await screen.findByRole('dialog', { name: 'Nouvel appareil' });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(accepterNouvelAppareil).not.toHaveBeenCalled();
    expect(champ()).toHaveValue('Salut');
  });

  it('un message de l’autre affiché lance son compte à rebours', () => {
    afficher();
    expect(marquerAffiche).toHaveBeenCalledWith(client, SALON, '$m2');
    expect(marquerAffiche).not.toHaveBeenCalledWith(client, SALON, '$m1');
  });

  it('l’encadré « La demande » se replie', () => {
    afficher();
    const entete = screen.getByRole('button', { name: /La demande/ });
    fireEvent.click(entete);
    expect(entete).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText("Fuite sous l'évier, ce soir")).not.toBeInTheDocument();
  });

  it('« en train d’écrire… » quand l’autre tape', () => {
    vi.mocked(listerBulles).mockReturnValue([resume({ autreEcrit: true })]);
    afficher();
    expect(screen.getByText("en train d'écrire…")).toBeInTheDocument();
  });

  it('écrire signale la frappe, envoyer vide le champ', async () => {
    afficher();
    fireEvent.change(champ(), { target: { value: 'D’accord.' } });
    expect(signalerEcriture).toHaveBeenCalledWith(client, SALON, true);
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    await vi.waitFor(() => expect(champ()).toHaveValue(''));
    expect(envoyerMessage).toHaveBeenCalledWith(client, SALON, 'D’accord.');
    expect(signalerEcriture).toHaveBeenLastCalledWith(client, SALON, false);
  });

  it('envoi impossible : bandeau, le texte reste', async () => {
    vi.mocked(envoyerMessage).mockRejectedValue(
      Object.assign(new Error('x'), { name: 'ConnectionError' }),
    );
    afficher();
    fireEvent.change(champ(), { target: { value: 'Allô' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
    expect(champ()).toHaveValue('Allô');
  });

  it('Silence Radio : confirmation, puis tout s’efface et retour au Mur', async () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Silence Radio' }));
    expect(screen.getByRole('dialog', { name: 'Silence Radio ?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));
    expect(await screen.findByText('écran mur')).toBeInTheDocument();
    expect(silenceRadio).toHaveBeenCalledWith(client, SALON);
  });

  it('Silence Radio annulé : rien n’est effacé', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Silence Radio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(silenceRadio).not.toHaveBeenCalled();
  });

  it('l’autre est parti : « La bulle est fermée », saisie bloquée', () => {
    vi.mocked(listerBulles).mockReturnValue([resume({ etat: 'fermee' })]);
    afficher();
    expect(screen.getByText('La bulle est fermée.')).toBeInTheDocument();
    expect(champ()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Silence Radio' })).not.toBeInTheDocument();
  });

  it('l’autre n’a pas encore rejoint : « En attente de l’autre… »', () => {
    vi.mocked(listerBulles).mockReturnValue([resume({ etat: 'en-attente' })]);
    afficher();
    expect(screen.getAllByText("En attente de l'autre…").length).toBeGreaterThan(0);
    expect(champ()).toBeDisabled();
  });

  it('flèche « Le Mur » : retour au Mur', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Le Mur' }));
    expect(screen.getByText('écran mur')).toBeInTheDocument();
  });
});
