import {
  ConditionKind,
  PushRuleActionName,
  PushRuleKind,
  type MatrixClient,
} from 'matrix-js-sdk';
import { lireDisponible } from '../appareil/disponible';
import { pushNatif, type PushNatif } from '../appareil/push-natif';
import { APP_ID_PUSH, URL_PASSERELLE_PUSH } from '../config';
import { TYPE_ANNONCE } from './evenements';
import { rejoindreMur } from './mur';

/*
 * Notifications par Firebase (Google), Android seulement.
 * Le « pusher » Matrix dit au serveur où envoyer un signal ; format « event_id_only » : le signal ne contient
 * AUCUN texte ni nom. La passerelle du serveur le transmet à Google, et le téléphone affiche une notification
 * neutre (« Du nouveau »). Google ne sait donc que « ce téléphone a reçu un signal à telle heure ».
 */

const CLE_PUSHKEY = 'sia.pushkey';
const DELAI_RETRAIT_MS = 5_000;
const NOM_APPLI = 'SIA';
/** Règle de notification des demandes de clients (les règles par défaut ne connaissent pas ce type d'événement). */
const ID_REGLE_DEMANDES = 'sia.demandes';

/** Ce que voit l'écran « Mon compte ». `inactif` = navigateur ou pas encore lancé. */
export type StatutNotifications = 'inactif' | 'actif' | 'indisponible' | 'autorisation-refusee';

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

/** Enregistre le pusher pour ce jeton ; retire l'ancien si le jeton a changé. */
async function publierPusher(client: MatrixClient, jeton: string): Promise<void> {
  const ancien = pushkeyMemorisee();
  await client.setPusher({
    kind: 'http',
    app_id: APP_ID_PUSH,
    app_display_name: NOM_APPLI,
    device_display_name: NOM_APPLI,
    lang: 'fr',
    pushkey: jeton,
    data: { url: URL_PASSERELLE_PUSH, format: 'event_id_only' },
    append: false,
  });
  memoriser(jeton);
  if (ancien !== null && ancien !== jeton) {
    await retirerPusher(client, ancien).catch(() => undefined);
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
    // Google donne (ou change) le jeton de ce téléphone : le serveur doit le savoir.
    await natif.addListener('jeton', ({ jeton }) => {
      publierPusher(client, jeton).then(
        () => changer('actif'),
        () => undefined,
      );
    }),
  ];
}

/**
 * Prestataire DISPONIBLE : prévenir quand un client pose une demande sur le Mur (pas de notification sinon : un client
 * n'a pas à être dérangé par les demandes des autres). Ne rejette jamais.
 */
export async function reglerNotificationDemandes(
  client: MatrixClient,
  disponible: boolean,
): Promise<void> {
  try {
    if (!disponible) {
      await client.deletePushRule('global', PushRuleKind.Override, ID_REGLE_DEMANDES);
      return;
    }
    const salonMur = await rejoindreMur(client);
    await client.addPushRule('global', PushRuleKind.Override, ID_REGLE_DEMANDES, {
      conditions: [
        { kind: ConditionKind.EventMatch, key: 'type', pattern: TYPE_ANNONCE },
        { kind: ConditionKind.EventMatch, key: 'room_id', pattern: salonMur },
      ],
      actions: [PushRuleActionName.Notify],
    });
  } catch {
    // Règle déjà absente, serveur injoignable : elle sera refaite à la prochaine ouverture ou au prochain changement.
  }
}

/**
 * À la connexion (appelée à chaque ouverture) : demande à Google le jeton de ce téléphone, publie le pusher et règle
 * la notification des demandes selon la disponibilité. Hors Android : ne fait rien. Ne rejette jamais.
 */
export async function lancerNotifications(client: MatrixClient): Promise<StatutNotifications> {
  const natif = pushNatif();
  if (!natif) return statut;
  try {
    await ecouter(natif, client);
    const etat = await natif.etat();
    if (etat.jeton) {
      await publierPusher(client, etat.jeton).catch(() => undefined);
    }
    const { statut: resultat } = await natif.activer();
    if (resultat === 'ok') changer(etat.jeton ? 'actif' : statut);
    else changer(resultat);
    void reglerNotificationDemandes(client, lireDisponible());
  } catch {
    // Plugin ou Google en panne : l'appli marche sans notification.
  }
  return statut;
}

/** À la déconnexion : retire le pusher du serveur (5 s au plus) et éteint Firebase sur ce téléphone. Ne rejette jamais. */
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
    // Firebase absent : rien à défaire.
  }
}
