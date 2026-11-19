import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useLocation, useNavigate } from 'react-router-dom';
import { cheminBulle } from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { lireDisponible } from '../../appareil/disponible';
import { texteBandeau } from '../../logique/demande';
import { doitNotifier } from '../../logique/notification';
import type { ParticipantBulle } from '../../logique/etat-bulle';
import { accepterOffre, direOui, refuserOffre } from '../../matrix/bulles';
import type { ResumeBulle } from '../../matrix/bulles';
import { demandesActives, ecouterDemandes, monStatutActif } from '../../matrix/mur';
import type { DemandeRecue } from '../../matrix/mur';
import { lireProfil } from '../../matrix/profil';
import { lireSession } from '../../matrix/session';
import { useGlisse } from '../../ui/useGlisse';
import { familleErreur } from '../profil-client/branchements';
import { cleCarte, salonDeAdresse } from './alertes-bulles';
import type { CarteBulle } from './alertes-bulles';
import { CarteAlerte } from './CarteAlerte';
import type { VueAlerte } from './CarteAlerte';
import { commencerReponse, enFile, finirReponse, rater } from './reponses';
import { EVENEMENT_DISPONIBLE, signalerChoix } from './signal';
import { useAlertesBulles } from './useAlertesBulles';
import { ajouterVue, lireVues } from './vues';
import './bandeau.css';

/*
 * Bandeaux M1 / M2, posés au-dessus de tout écran (appli ouverte seulement) :
 * - prestataire disponible : une demande de client arrive → « D'accord ? » Non / Oui ;
 * - client : un prestataire a dit oui → « Tu veux discuter ? » Non / Oui ;
 * - ma bulle s'ouvre (« X a accepté. ») ou un message arrive dans une bulle où je ne suis pas
 *   (« Nouveau message de X », jamais son texte) → un seul bouton « Ouvrir » (alertes-bulles.ts).
 * Les alertes s'empilent : la plus récente en haut, trois au plus à la fois ; les autres attendent.
 * Un toucher Oui / Non change la carte tout de suite (« Réponse envoyée… ») ; elle s'en va quand le serveur confirme.
 */

type Alerte =
  | { type: 'demande'; cle: string; demande: DemandeRecue }
  | { type: 'offre'; cle: string; bulle: ResumeBulle }
  | { type: 'carte'; cle: string; carte: CarteBulle };

/** Alertes montrées en même temps. */
const NB_VISIBLES = 3;
const VIBRATION_MS = 80;

function estDisponible(c: MatrixClient): boolean {
  return monStatutActif(c) !== null || lireDisponible();
}

/** Pseudo et quartier publics du prestataire (statut du Mur, sinon son profil). */
async function moiPublic(c: MatrixClient): Promise<ParticipantBulle> {
  const statut = monStatutActif(c)?.statut;
  if (statut) return { pseudo: statut.pseudo, zone: statut.zone };
  const session = lireSession();
  const lu = session ? await lireProfil(session) : null;
  if (lu?.ok && lu.profil) return { pseudo: lu.profil.pseudo, zone: lu.profil.zone };
  throw new Error('Profil introuvable.');
}

function vueDe(a: Alerte): VueAlerte {
  if (a.type === 'demande') {
    return {
      cle: a.cle,
      nom: 'Nouvelle demande',
      ligne: texteBandeau(a.demande.demande),
      question: "D'accord ?",
    };
  }
  if (a.type === 'carte') {
    const { genre, pseudo } = a.carte;
    return genre === 'ouverte'
      ? { cle: a.cle, nom: 'Bulle ouverte', ligne: `${pseudo} a accepté.` }
      : { cle: a.cle, nom: 'Nouveau message', ligne: `Nouveau message de ${pseudo}` };
  }
  const { pseudo, zone } = a.bulle.autre;
  const direct = a.bulle.invitationDirecte === true;
  return {
    cle: a.cle,
    nom: direct ? 'Nouvelle demande directe' : 'Nouvelle offre',
    ligne: `${pseudo} (${zone}) ${direct ? 'vous demande' : 'dit oui'}`,
    question: 'Tu veux discuter ?',
  };
}

/**
 * Remet à jour les alertes d'UN type d'après la liste de celles qui doivent exister : celles qui ne sont
 * plus voulues s'en vont, les nouvelles arrivent en fin de file (donc en haut de la pile). Les autres types
 * ne bougent pas : une demande a sa propre vie, une offre ne dépend que d'une vraie liste de bulles.
 */
function remplacerType(file: Alerte[], type: Alerte['type'], voulues: Alerte[]): Alerte[] {
  const cles = new Set(voulues.map((a) => a.cle));
  const gardees = file.filter((a) => a.type !== type || cles.has(a.cle));
  const presentes = new Set(gardees.map((a) => a.cle));
  const nouvelles = voulues.filter((a) => !presentes.has(a.cle));
  return nouvelles.length === 0 && gardees.length === file.length
    ? file
    : [...gardees, ...nouvelles];
}

function alertesOffres(offres: ResumeBulle[]): Alerte[] {
  return offres.map((bulle) => ({ type: 'offre', cle: bulle.roomId, bulle }));
}

/** La bulle la plus active (la première de la liste) arrive en dernier : elle se retrouve en haut de la pile. */
function alertesCartes(cartes: CarteBulle[]): Alerte[] {
  return cartes.map((carte): Alerte => ({ type: 'carte', cle: cleCarte(carte), carte })).reverse();
}

export function Bandeau() {
  const { client } = useMatrix();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // La bulle affichée à l'écran : on n'y alerte pas de ce qui s'y passe, on y est.
  const ouverte = salonDeAdresse(pathname);
  // Dans l'ordre d'arrivée : la plus récente est la dernière.
  const [file, setFile] = useState<Alerte[]>([]);
  const vues = useRef<Set<string> | null>(null);
  const annoncees = useRef(new Set<string>());
  const pile = useGlisse<HTMLDivElement>({ arrivee: false });

  const dejaVues = useCallback((): Set<string> => {
    vues.current ??= lireVues();
    return vues.current;
  }, []);

  const retirer = useCallback((cle: string) => {
    setFile((f) => f.filter((x) => x.cle !== cle));
  }, []);

  // Prestataire : demandes du Mur.
  useEffect(() => {
    if (!client) return;
    const moi = client.getUserId() ?? '';
    const proposer = (d: DemandeRecue): void => {
      const contexte = {
        moi,
        disponible: estDisponible(client),
        dejaVues: dejaVues(),
        maintenant: Date.now(),
      };
      if (!doitNotifier(d, contexte)) return;
      setFile((f) =>
        f.some((x) => x.cle === d.eventId)
          ? f
          : [...f, { type: 'demande', cle: d.eventId, demande: d }],
      );
    };
    const relire = (): void => {
      if (!estDisponible(client)) return;
      demandesActives(client)
        .then((demandes) => demandes.forEach(proposer))
        .catch(() => undefined); // Réseau coupé : les nouvelles demandes arriveront quand même.
    };
    const arreter = ecouterDemandes(client, proposer, retirer);
    relire();
    window.addEventListener(EVENEMENT_DISPONIBLE, relire);
    return () => {
      arreter();
      window.removeEventListener(EVENEMENT_DISPONIBLE, relire);
    };
  }, [client, dejaVues, retirer]);

  // Bulles : offres reçues (invitations), « X a accepté. » et « Nouveau message de X ».
  useAlertesBulles(client, ouverte, {
    offres: (offres) => setFile((f) => remplacerType(f, 'offre', alertesOffres(offres))),
    cartes: (cartes) => setFile((f) => remplacerType(f, 'carte', alertesCartes(cartes))),
  });

  // Une vibration courte quand une nouvelle alerte arrive (sans texte hors de l'appli).
  useEffect(() => {
    const nouvelle = file.some((a) => !annoncees.current.has(a.cle));
    annoncees.current = new Set(file.map((a) => a.cle));
    if (!nouvelle) return;
    try {
      navigator.vibrate?.(VIBRATION_MS);
    } catch {
      // Vibration refusée par le téléphone : rien de grave.
    }
  }, [file]);

  if (!client) return null;
  const c = client;

  /** Un seul bouton « Ouvrir » : la carte s'en va tout de suite (avec l'autre carte de la même bulle) et on entre. */
  function ouvrir(carte: CarteBulle): void {
    setFile((f) => f.filter((x) => x.type !== 'carte' || x.carte.roomId !== carte.roomId));
    navigate(cheminBulle(carte.roomId));
  }

  async function repondre(alerte: Exclude<Alerte, { type: 'carte' }>, oui: boolean): Promise<void> {
    const { cle } = alerte;
    if (alerte.type === 'demande' && !oui) {
      // « Non » à une demande : rien à envoyer. La carte s'en va tout de suite et ne revient jamais.
      vues.current = ajouterVue(dejaVues(), cle);
      retirer(cle);
      return;
    }
    // Déjà répondu (ici ou dans la liste des bulles) : on ne répond pas deux fois.
    if (!commencerReponse(cle)) return;
    try {
      let bulleExistante: string | null = null;
      if (alerte.type === 'demande') {
        const r = await direOui(c, alerte.demande.demande, cle, await moiPublic(c));
        if (r.reutilisee) bulleExistante = r.roomId;
        vues.current = ajouterVue(dejaVues(), cle);
      } else if (oui) {
        await enFile(() => accepterOffre(c, cle));
        // Le choix est fait (accepterOffre oublie déjà la demande locale) : la page client repasse au gris.
        signalerChoix();
      } else {
        await refuserOffre(c, cle);
      }
      retirer(cle);
      finirReponse(cle);
      if (alerte.type === 'offre' && oui) navigate(cheminBulle(cle));
      // « Oui » à un client avec qui une bulle est déjà ouverte : on y va.
      if (bulleExistante !== null) navigate(cheminBulle(bulleExistante));
    } catch (e) {
      if (familleErreur(e) === 'reseau') {
        rater(cle, 'reseau');
        return;
      }
      // Demande retirée, expirée ou offre déjà fermée : la carte s'en va.
      if (alerte.type === 'demande') vues.current = ajouterVue(dejaVues(), cle);
      retirer(cle);
      finirReponse(cle);
    }
  }

  const visibles = file.slice(-NB_VISIBLES).reverse();
  return (
    <div className="notif" ref={pile} aria-live="polite" aria-relevant="additions">
      {visibles.map((a) => (
        <CarteAlerte
          key={a.cle}
          vue={vueDe(a)}
          onRepondre={(oui) => {
            if (a.type !== 'carte') void repondre(a, oui);
          }}
          onOuvrir={() => {
            if (a.type === 'carte') ouvrir(a.carte);
          }}
        />
      ))}
    </div>
  );
}
