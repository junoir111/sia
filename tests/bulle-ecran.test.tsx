import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS, cheminBulle } from '../src/chemins';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { Bulle } from '../src/ecrans/bulle/Bulle';
import { pseudoDe } from '../src/matrix/annuaire';
import {
  ErreurEnvoiBulle,
  accepterNouvelAppareil,
  bulleSaine,
  chargerPhoto,
  envoyerMessage,
  envoyerPhoto,
  listerBulles,
  prechaufferBulle,
  reessayerMessage,
  signalerEcriture,
  silenceRadio,
  surveillerBulle,
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
vi.mock('../src/matrix/bulles', async (importOriginal) => ({
  lireEtat: (await importOriginal<typeof import('../src/matrix/bulles')>()).lireEtat,
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
  chargerPhoto: vi.fn(),
  ecouterBulles: vi.fn(() => () => undefined),
  listerBulles: vi.fn(),
  envoyerMessage: vi.fn(),
  envoyerPhoto: vi.fn(),
  prechaufferBulle: vi.fn(),
  reessayerMessage: vi.fn(),
  signalerEcriture: vi.fn(),
  silenceRadio: vi.fn(),
  surveillerBulle: vi.fn(),
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
  /** Contenu d'un message PHOTO (événement m.image avec un fichier chiffré). */
  photo?: unknown;
  /** Statut d'un écho local (null : événement venu du serveur). */
  status?: string | null;
  txn?: string;
  roomId?: string;
};

/** Fichier chiffré bien formé (reconnu par estFichierChiffre). */
const FICHIER_PHOTO = {
  v: 'v2',
  url: 'mxc://sia.tail94dc60.ts.net/abc',
  iv: 'AAAAAAAAAAAAAAAA',
  key: { alg: 'A256CTR', k: 'kkkk', kty: 'oct' },
  hashes: { sha256: 'hhhh' },
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
    getContent: () =>
      e.photo
        ? { msgtype: 'm.image', body: 'Photo', file: e.photo }
        : { msgtype: 'm.text', body: e.body },
    getSender: () => e.sender,
    getRoomId: () => e.roomId ?? SALON,
    status: e.status ?? null,
    getTxnId: () => e.txn,
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
    vi.mocked(prechaufferBulle).mockReset();
    vi.mocked(signalerEcriture).mockReset().mockResolvedValue(undefined);
    vi.mocked(silenceRadio).mockReset().mockResolvedValue(undefined);
    vi.mocked(marquerAffiche).mockReset();
    vi.mocked(bulleSaine).mockReset().mockReturnValue(true);
    vi.mocked(accepterNouvelAppareil).mockReset().mockResolvedValue(undefined);
    vi.mocked(pseudoDe).mockReset().mockReturnValue(null);
    vi.mocked(reessayerMessage).mockReset().mockResolvedValue('$m9');
    vi.mocked(surveillerBulle)
      .mockReset()
      .mockReturnValue(() => undefined);
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

  it('le fil qui se rafraîchit ne relance pas le compte à rebours d’un message déjà affiché', () => {
    afficher();
    expect(marquerAffiche).toHaveBeenCalledTimes(1);
    const { on } = client as unknown as { on: ReturnType<typeof vi.fn> };
    const relire = on.mock.calls.find(([nom]) => nom === 'Room.timeline')?.[1] as
      | (() => void)
      | undefined;
    expect(relire).toBeDefined();
    // Chaque rafraîchissement du fil refait des objets « message » tout neufs.
    act(() => relire?.());
    act(() => relire?.());
    expect(marquerAffiche).toHaveBeenCalledTimes(1);
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

  it('la 1re frappe prépare le chiffrement, puis pas de rafale pendant la frappe', () => {
    afficher();
    fireEvent.change(champ(), { target: { value: 'S' } });
    expect(prechaufferBulle).toHaveBeenCalledTimes(1);
    expect(prechaufferBulle).toHaveBeenCalledWith(client, SALON);
    fireEvent.change(champ(), { target: { value: 'Sa' } });
    fireEvent.change(champ(), { target: { value: 'Sal' } });
    expect(prechaufferBulle).toHaveBeenCalledTimes(1);
    // Champ vidé puis nouvelle frappe : c'est de nouveau une première frappe.
    fireEvent.change(champ(), { target: { value: '' } });
    expect(prechaufferBulle).toHaveBeenCalledTimes(1);
    fireEvent.change(champ(), { target: { value: 'L' } });
    expect(prechaufferBulle).toHaveBeenCalledTimes(2);
  });

  it('rien n’est préparé quand on ne peut pas écrire (en attente de l’autre, bulle pas sûre)', () => {
    vi.mocked(listerBulles).mockReturnValue([resume({ etat: 'en-attente' })]);
    afficher();
    fireEvent.change(champ(), { target: { value: 'Salut' } });
    expect(prechaufferBulle).not.toHaveBeenCalled();
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

  it('ouvrir la bulle lance la surveillance (vérifications faites une fois)', () => {
    afficher();
    expect(surveillerBulle).toHaveBeenCalledWith(client, SALON);
  });

  it('mon message en cours d’envoi s’affiche tout de suite avec « envoi… »', () => {
    client = fauxClient([
      {
        id: '~e1',
        body: 'tout de suite',
        sender: MOI,
        enClair: true,
        status: 'sending',
        txn: 't1',
      },
    ]);
    vi.mocked(useMatrix).mockReturnValue({ client, etat: 'pret' });
    afficher();
    expect(screen.getByText('tout de suite')).toBeInTheDocument();
    expect(screen.getByText('envoi…')).toBeInTheDocument();
  });

  it('écho local refusé s’il n’est pas à moi, pas de ce salon, ou annulé', () => {
    client = fauxClient([
      { id: '~e1', body: 'faux écho', sender: AUTRE, enClair: true, status: 'sending' },
      {
        id: '~e2',
        body: 'autre salon',
        sender: MOI,
        enClair: true,
        status: 'sending',
        roomId: '!ailleurs:sia',
      },
      { id: '~e3', body: 'annulé', sender: MOI, enClair: true, status: 'cancelled' },
      { id: '~e4', body: 'statut inconnu', sender: MOI, enClair: true, status: 'bizarre' },
      { id: '$e5', body: 'en clair à moi', sender: MOI, enClair: true },
    ]);
    vi.mocked(useMatrix).mockReturnValue({ client, etat: 'pret' });
    afficher();
    for (const texte of [
      'faux écho',
      'autre salon',
      'annulé',
      'statut inconnu',
      'en clair à moi',
    ]) {
      expect(screen.queryByText(texte)).not.toBeInTheDocument();
    }
  });

  it('message confirmé : plus de « envoi… »', () => {
    client = fauxClient([{ id: '$ok', body: 'parti', sender: MOI, status: 'sent', txn: 't2' }]);
    vi.mocked(useMatrix).mockReturnValue({ client, etat: 'pret' });
    afficher();
    expect(screen.getByText('parti')).toBeInTheDocument();
    expect(screen.queryByText('envoi…')).not.toBeInTheDocument();
  });

  it('pas envoyé : toucher pour réessayer renvoie ce message', () => {
    client = fauxClient([
      { id: '~rate', body: 'raté', sender: MOI, enClair: true, status: 'not_sent', txn: 't3' },
    ]);
    vi.mocked(useMatrix).mockReturnValue({ client, etat: 'pret' });
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'pas envoyé, toucher pour réessayer' }));
    expect(reessayerMessage).toHaveBeenCalledWith(client, SALON, '~rate');
  });

  it('le champ se vide dès le toucher « envoyer », sans attendre le serveur', () => {
    vi.mocked(envoyerMessage).mockReturnValue(new Promise(() => undefined));
    afficher();
    fireEvent.change(champ(), { target: { value: 'Vite' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(champ()).toHaveValue('');
    expect(envoyerMessage).toHaveBeenCalledWith(client, SALON, 'Vite');
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeEnabled();
  });

  it('la touche Entrée envoie', () => {
    afficher();
    fireEvent.change(champ(), { target: { value: 'Par Entrée' } });
    fireEvent.keyDown(champ(), { key: 'Enter' });
    expect(envoyerMessage).toHaveBeenCalledTimes(1);
    expect(envoyerMessage).toHaveBeenCalledWith(client, SALON, 'Par Entrée');
    expect(champ()).toHaveValue('');
  });

  it('Entrée sur un champ vide n’envoie rien', () => {
    afficher();
    fireEvent.keyDown(champ(), { key: 'Enter' });
    expect(envoyerMessage).not.toHaveBeenCalled();
  });

  it('échec réseau après affichage : pas de bandeau, le champ reste vide', async () => {
    vi.mocked(envoyerMessage).mockRejectedValue(new ErreurEnvoiBulle('pas-envoye'));
    afficher();
    fireEvent.change(champ(), { target: { value: 'Coupé' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    await vi.waitFor(() => expect(envoyerMessage).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(champ()).toHaveValue('');
  });
});

describe('Photos dans la bulle', () => {
  const vraiCreer = URL.createObjectURL;
  const vraiRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:photo');
    URL.revokeObjectURL = vi.fn();
    client = fauxClient([{ id: '$ph', body: 'Photo', sender: AUTRE, photo: FICHIER_PHOTO }]);
    vi.mocked(useMatrix).mockReturnValue({ client, etat: 'pret' });
    vi.mocked(listerBulles).mockReset().mockReturnValue([resume()]);
    vi.mocked(bulleSaine).mockReset().mockReturnValue(true);
    vi.mocked(surveillerBulle).mockReset().mockReturnValue(() => undefined);
    vi.mocked(signalerEcriture).mockReset().mockResolvedValue(undefined);
    vi.mocked(marquerAffiche).mockReset();
    vi.mocked(pseudoDe).mockReturnValue('palmier-48');
    vi.mocked(chargerPhoto).mockReset();
    vi.mocked(envoyerPhoto).mockReset().mockResolvedValue('$px');
  });

  afterEach(() => {
    URL.createObjectURL = vraiCreer;
    URL.revokeObjectURL = vraiRevoke;
    vi.useRealTimers();
  });

  it('une photo reçue est voilée ; on la touche et elle s’affiche', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    vi.mocked(chargerPhoto).mockResolvedValue(blob);
    afficher();
    expect(screen.queryByRole('img', { name: 'Photo' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Touche pour voir/ }));
    const img = await screen.findByRole('img', { name: 'Photo' });
    expect(img).toHaveAttribute('src', 'blob:photo');
    expect(chargerPhoto).toHaveBeenCalledWith(client, FICHIER_PHOTO);
  });

  it('dévoilée, la photo se recouvre au bout de 5 s et les octets sont relâchés', async () => {
    vi.mocked(chargerPhoto).mockResolvedValue(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }));
    vi.useFakeTimers();
    afficher();
    fireEvent.click(screen.getByRole('button', { name: /Touche pour voir/ }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('img', { name: 'Photo' })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByRole('img', { name: 'Photo' })).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });

  it('photo illisible : un repère, pas d’image', async () => {
    vi.mocked(chargerPhoto).mockResolvedValue(null);
    afficher();
    fireEvent.click(screen.getByRole('button', { name: /Touche pour voir/ }));
    expect(await screen.findByText('Photo illisible')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Photo' })).not.toBeInTheDocument();
  });

  it('le bouton photo de la barre envoie la photo choisie', async () => {
    client = fauxClient([]);
    vi.mocked(useMatrix).mockReturnValue({ client, etat: 'pret' });
    afficher();
    const fichier = new File([new Uint8Array([9, 9, 9])], 'moi.jpg', { type: 'image/jpeg' });
    const entree = screen.getByLabelText('Envoyer une photo', { selector: 'input' });
    fireEvent.change(entree, { target: { files: [fichier] } });
    await vi.waitFor(() => expect(envoyerPhoto).toHaveBeenCalledWith(client, SALON, fichier));
  });
});
