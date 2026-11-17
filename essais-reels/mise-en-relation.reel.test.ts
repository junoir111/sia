import { readFileSync } from 'node:fs';
import {
  ClientEvent,
  createClient,
  KnownMembership,
  SyncState,
  type MatrixClient,
} from 'matrix-js-sdk';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ADRESSE_SERVEUR } from '../src/config';
import { DUREE_DEMANDE_MS, type DemandeClient } from '../src/logique/demande';
import {
  accepterOffre,
  direOui,
  envoyerMessage,
  listerBulles,
  silenceRadio,
} from '../src/matrix/bulles';
import { marquerAffiche, arreterEphemere } from '../src/matrix/ephemere';
import {
  demandesActives,
  ecouterDemandes,
  publierDemande,
  rejoindreMur,
  retirerDemande,
  type DemandeRecue,
} from '../src/matrix/mur';

/*
 * Essai réel : essai-client publie une demande, essai-presta dit oui, le client accepte, un message chiffré
 * passe puis est effacé, la demande est retirée. Mots de passe lus dans secrets/compte-test.txt, JAMAIS affichés.
 * Sous Node il n'y a pas d'IndexedDB : la base de chiffrement est en mémoire (initRustCrypto useIndexedDB:false),
 * le reste utilise les vraies fonctions de src/matrix/.
 */

const FICHIER_SECRETS = 'C:/Users/HP/Documents/Sia/secrets/compte-test.txt';

function motDePasse(identifiant: string): string {
  const lignes = readFileSync(FICHIER_SECRETS, 'utf8').split(/\r?\n/);
  const i = lignes.findIndex((l) => l.trim() === `identifiant: ${identifiant}`);
  const ligne = i >= 0 ? lignes[i + 1] : undefined;
  const trouve = ligne ? /^mot de passe:\s*(.+)$/.exec(ligne.trim()) : null;
  if (!trouve?.[1]) throw new Error(`Mot de passe introuvable pour ${identifiant}.`);
  return trouve[1].trim();
}

const silence = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  getChild: () => silence,
};

async function connecter(identifiant: string): Promise<MatrixClient> {
  const temp = createClient({ baseUrl: ADRESSE_SERVEUR, logger: silence });
  const r = await temp.loginRequest({
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: identifiant },
    password: motDePasse(identifiant),
    initial_device_display_name: 'SIA essai réel',
  });
  const c = createClient({
    baseUrl: ADRESSE_SERVEUR,
    accessToken: r.access_token,
    userId: r.user_id,
    deviceId: r.device_id,
    logger: silence,
  });
  await c.initRustCrypto({ useIndexedDB: false });
  const pret = new Promise<void>((ok) => {
    const f = (etat: SyncState): void => {
      if (etat === SyncState.Prepared) {
        c.off(ClientEvent.Sync, f);
        ok();
      }
    };
    c.on(ClientEvent.Sync, f);
  });
  await c.startClient({ initialSyncLimit: 20, lazyLoadMembers: true });
  await pret;
  return c;
}

async function attendre<T>(
  quoi: string,
  f: () => T | null | undefined | Promise<T | null | undefined>,
  ms = 30_000,
): Promise<T> {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > limite) throw new Error(`Délai dépassé : ${quoi}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const memoire = new Map<string, string>();
let client: MatrixClient;
let presta: MatrixClient;
const etapes: string[] = [];

beforeAll(async () => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memoire.get(k) ?? null,
    setItem: (k: string, v: string) => void memoire.set(k, v),
    removeItem: (k: string) => void memoire.delete(k),
    clear: () => memoire.clear(),
  });
  client = await connecter('essai-client');
  presta = await connecter('essai-presta');
  etapes.push('connexion des 2 comptes + chiffrement Rust');
});

afterAll(async () => {
  arreterEphemere();
  for (const c of [client, presta]) {
    if (!c) continue;
    await c.logout(true).catch(() => undefined);
  }
  // Seulement les noms des étapes réussies : aucun secret, aucun contenu de message.
  process.stdout.write(`\nÉtapes réussies :\n- ${etapes.join('\n- ')}\n`);
});

it('mise en relation complète', async () => {
  await rejoindreMur(client);
  await rejoindreMur(presta);
  etapes.push('les 2 comptes sont dans le Mur');

  const recues: DemandeRecue[] = [];
  const arreter = ecouterDemandes(presta, (d) => recues.push(d));
  const demande: DemandeClient = {
    pseudo: 'essai-client',
    service: 'Plombier',
    zone: 'Akanda',
    texte: 'Essai automatique',
    budget: 5000,
    fin: Date.now() + DUREE_DEMANDE_MS,
  };
  const idDemande = await publierDemande(client, demande);
  const vue = await attendre('demande reçue par le presta', () =>
    recues.find((d) => d.eventId === idDemande),
  );
  arreter();
  expect(vue.demande).toEqual(demande);
  expect((await demandesActives(presta)).some((d) => d.eventId === idDemande)).toBe(true);
  etapes.push('demande publiée et vue par le presta (écoute + demandesActives)');

  const roomId = await direOui(presta, vue.demande, idDemande, {
    pseudo: 'essai-presta',
    zone: 'Nzeng',
  });
  etapes.push('presta dit oui : bulle chiffrée créée et client invité');

  const offre = await attendre('invitation reçue', () =>
    listerBulles(client).find((b) => b.roomId === roomId && b.etat === 'invitation-recue'),
  );
  expect(offre.autre).toEqual({ pseudo: 'essai-presta', zone: 'Nzeng' });
  await accepterOffre(client, roomId);
  etapes.push('client voit l’offre (pseudo/zone) et l’accepte (bulle vérifiée chiffrée)');

  await attendre('bulle ouverte côté presta', () =>
    listerBulles(presta).find((b) => b.roomId === roomId && b.etat === 'ouverte'),
  );
  const idMessage = await envoyerMessage(presta, roomId, 'Bonjour, essai SIA');
  const recu = await attendre('message reçu et déchiffré', async () => {
    const ev = client.getRoom(roomId)?.findEventById(idMessage);
    if (!ev) return null;
    await client.decryptEventIfNeeded(ev);
    return ev.getType() === 'm.room.message' ? ev : null;
  });
  expect(recu.getWireType()).toBe('m.room.encrypted');
  expect(recu.getContent().body).toBe('Bonjour, essai SIA');
  etapes.push('message chiffré (m.room.encrypted sur le réseau) reçu et déchiffré par le client');

  marquerAffiche(client, roomId, idMessage);
  await attendre(
    'message effacé',
    () => client.getRoom(roomId)?.findEventById(idMessage)?.isRedacted(),
    120_000,
  );
  const surServeur = await client.fetchRoomEvent(roomId, idMessage);
  expect(surServeur.content ?? {}).toEqual({});
  etapes.push('message effacé après 1 min, contenu vide sur le serveur');

  await retirerDemande(client, idDemande);
  await attendre('demande retirée', async () =>
    (await demandesActives(presta)).every((d) => d.eventId !== idDemande),
  );
  etapes.push('demande retirée du Mur');

  await silenceRadio(client, roomId);
  await attendre(
    'client hors de la bulle',
    () =>
      client.getRoom(roomId)?.getMyMembership() === KnownMembership.Leave ||
      !client.getRoom(roomId),
  );
  await presta.leave(roomId);
  etapes.push('Silence Radio côté client, presta quitte : bulle fermée');
});
