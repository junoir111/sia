import type { MatrixClient } from 'matrix-js-sdk';
import { pushNatif, type PushNatif } from '../appareil/push-natif';
import { APP_ID_PUSH, URL_PASSERELLE_PUSH } from '../config';

/*
 * Notifications sans Firebase (UnifiedPush + ntfy), Android seulement.
 * Le « pusher » Matrix dit au serveur où envoyer un signal ; format « event_id_only » : le signal
 * ne contient AUCUN texte ni nom. L'appli affiche ensuite une notification neutre (« Du nouveau »).
 */

const CLE_PUSHKEY = 'sia.pushkey';
const DELAI_RETRAIT_MS = 5_000;
const NOM_APPLI = 'SIA';

/** Ce que voit l'écran « Mon compte ». `inactif` = navigateur ou pas encore lancé. */
export type StatutNotifications = 'inactif' | 'actif' | 'sans-distributeur' | 'autorisation-refusee';

let statut: StatutNotifications = 'inactif';
const abonnes = new Set<() => void>();
let ecoutes: Array<{ remove: () => Promise<void> }> = [];

function changer(nouveau: StatutNotifications): void {
  if (statut === nouveau) return;
  statut = nouveau;
  abonnes.forEach((a) => a());
}

export function statutNotifications(): StatutNotifications {
  return statut;
}

/** Pour useSyncExternalStore. */
export function surStatutNotifications(action: () => void): () => void {
  abonnes.add(action);
  return () => abonnes.delete(action);
}

function pushkeyMemorisee(): string | null {
  try {
    return localStorage.getItem(CLE_PUSHKEY);
  } catch {
    return null;
  }
}

function memoriser(pushkey: string | null): void {
  try {
    if (pushkey === null) localStorage.removeItem(CLE_PUSHKEY);
    else localStorage.setItem(CLE_PUSHKEY, pushkey);
  } catch {
    // Stockage indisponible : le pusher sera simplement refait à la prochaine ouverture.
  }
}

async function retirerPusher(client: MatrixClient, pushkey: string): Promise<void> {
  await client.setPusher({ kind: null, app_id: APP_ID_PUSH, pushkey } as never);
}

/** Enregistre le pusher pour cette adresse ; retire l'ancien si l'adresse a changé. */
async function publierPusher(client: MatrixClient, endpoint: string): Promise<void> {
  const ancienne = pushkeyMemorisee();
  await client.setPusher({
    kind: 'http',
    app_id: APP_ID_PUSH,
    app_display_name: NOM_APPLI,
    device_display_name: NOM_APPLI,
    lang: 'fr',
    pushkey: endpoint,
    data: { url: URL_PASSERELLE_PUSH, format: 'event_id_only' },
    append: false,
  });
  memoriser(endpoint);
  if (ancienne !== null && ancienne !== endpoint) {
    await retirerPusher(client, ancienne).catch(() => undefined);
  }
}

function arreterEcoutes(): void {
  const anciennes = ecoutes;
  ecoutes = [];
  for (const e of anciennes) void e.remove().catch(() => undefined);
}

async function ecouter(natif: PushNatif, client: MatrixClient): Promise<void> {
  arreterEcoutes();
  ecoutes = [
    await natif.addListener('endpoint', ({ endpoint }) => {
      publierPusher(client, endpoint).then(
        () => changer('actif'),
        () => undefined,
      );
    }),
    await natif.addListener('desinscrit', () => {
      const cle = pushkeyMemorisee();
      memoriser(null);
      changer('sans-distributeur');
      if (cle !== null) retirerPusher(client, cle).catch(() => undefined);
    }),
  ];
}

/**
 * À la connexion (appelée à chaque ouverture) : inscrit l'appli auprès du distributeur et publie le pusher.
 * Hors Android : ne fait rien. Ne rejette jamais.
 */
export async function lancerNotifications(client: MatrixClient): Promise<StatutNotifications> {
  const natif = pushNatif();
  if (!natif) return statut;
  try {
    await ecouter(natif, client);
    const etat = await natif.etat();
    if (etat.endpoint) {
      await publierPusher(client, etat.endpoint).catch(() => undefined);
    }
    const { statut: resultat } = await natif.activer();
    if (resultat === 'ok') changer(etat.endpoint ? 'actif' : statut);
    else changer(resultat);
  } catch {
    // Plugin ou distributeur en panne : l'appli marche sans notification.
  }
  return statut;
}

/** À la déconnexion : retire le pusher du serveur (5 s au plus) et se désinscrit du distributeur. Ne rejette jamais. */
export async function arreterNotifications(client: MatrixClient | null): Promise<void> {
  const natif = pushNatif();
  const cle = pushkeyMemorisee();
  arreterEcoutes();
  changer('inactif');
  if (!natif && cle === null) return;
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<void>((resoudre) => {
    minuterie = setTimeout(resoudre, DELAI_RETRAIT_MS);
  });
  const retrait =
    client && cle !== null ? retirerPusher(client, cle).catch(() => undefined) : Promise.resolve();
  try {
    await Promise.race([retrait, delai]);
  } finally {
    clearTimeout(minuterie);
  }
  memoriser(null);
  try {
    await natif?.desactiver();
  } catch {
    // Distributeur absent : rien à défaire.
  }
}
