import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useNavigate } from 'react-router-dom';
import { cheminBulle } from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { lireDisponible } from '../../appareil/disponible';
import { texteBandeau } from '../../logique/demande';
import { doitNotifier } from '../../logique/notification';
import type { ParticipantBulle } from '../../logique/etat-bulle';
import { accepterOffre, direOui, ecouterBulles, refuserOffre } from '../../matrix/bulles';
import type { ResumeBulle } from '../../matrix/bulles';
import { demandesActives, ecouterDemandes, monStatutActif } from '../../matrix/mur';
import type { DemandeRecue } from '../../matrix/mur';
import { lireProfil } from '../../matrix/profil';
import { lireSession } from '../../matrix/session';
import { familleErreur } from '../profil-client/branchements';
import { EVENEMENT_DISPONIBLE, signalerChoix } from './signal';
import { ajouterVue, lireVues } from './vues';
import './bandeau.css';

/*
 * Bandeaux M1 / M2, posés au-dessus de tout écran (appli ouverte seulement) :
 * - prestataire disponible : une demande de client arrive → « D'accord ? » Non / Oui ;
 * - client : un prestataire a dit oui → « Tu veux discuter ? » Non / Oui.
 * Un seul bandeau à la fois ; les suivants attendent leur tour.
 */

type Element =
  | { type: 'demande'; cle: string; demande: DemandeRecue }
  | { type: 'offre'; cle: string; bulle: ResumeBulle };

const VIBRATION_MS = 80;
const TAILLE_LIGNE = 15;
const TAILLE_LIGNE_MIN = 13;
const PAS_DE_RESEAU = 'Pas de connexion. Réessaie.';

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

function textes(el: Element): { ligne: string; question: string; nom: string } {
  if (el.type === 'demande') {
    return {
      ligne: texteBandeau(el.demande.demande),
      question: "D'accord ?",
      nom: 'Nouvelle demande',
    };
  }
  const { pseudo, zone } = el.bulle.autre;
  return {
    ligne: `${pseudo} (${zone}) dit oui`,
    question: 'Tu veux discuter ?',
    nom: 'Nouvelle offre',
  };
}

/** Réduit un peu la taille du texte (jusqu'à 13 px) pour qu'il tienne sur une ligne, comme la maquette. */
function useTexteAjuste(texte: string | null) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const p = ref.current;
    if (!p || texte === null) return;
    let taille = TAILLE_LIGNE;
    p.style.fontSize = `${taille}px`;
    while (p.scrollWidth > p.clientWidth && taille > TAILLE_LIGNE_MIN) {
      taille -= 0.5;
      p.style.fontSize = `${taille}px`;
    }
  }, [texte]);
  return ref;
}

export function Bandeau() {
  const { client } = useMatrix();
  const navigate = useNavigate();
  const [file, setFile] = useState<Element[]>([]);
  const [occupe, setOccupe] = useState(false);
  // Message d'échec, attaché au bandeau qui l'a eu (il disparaît avec lui).
  const [echec, setEchec] = useState<{ cle: string; texte: string } | null>(null);
  const vues = useRef<Set<string> | null>(null);
  const actuel = file[0] ?? null;
  const ligne = useTexteAjuste(actuel ? textes(actuel).ligne : null);

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

  // Client : offres reçues (invitations dans une bulle).
  useEffect(() => {
    if (!client) return;
    return ecouterBulles(client, (bulles) => {
      const offres = bulles.filter((b) => b.etat === 'invitation-recue');
      const encore = new Set(offres.map((b) => b.roomId));
      setFile((f) => {
        const gardes = f.filter((x) => x.type === 'demande' || encore.has(x.cle));
        const nouvelles: Element[] = offres
          .filter((b) => !gardes.some((x) => x.cle === b.roomId))
          .map((b) => ({ type: 'offre', cle: b.roomId, bulle: b }));
        return nouvelles.length === 0 && gardes.length === f.length ? f : [...gardes, ...nouvelles];
      });
    });
  }, [client]);

  // Une vibration courte à chaque nouveau bandeau (sans texte hors de l'appli).
  const cleActuelle = actuel?.cle ?? null;
  useEffect(() => {
    if (cleActuelle === null) return;
    try {
      navigator.vibrate?.(VIBRATION_MS);
    } catch {
      // Vibration refusée par le téléphone : rien de grave.
    }
  }, [cleActuelle]);

  if (!client || !actuel) return null;
  const c = client;
  const el = actuel;

  async function agir(oui: boolean) {
    if (occupe) return;
    setOccupe(true);
    setEchec(null);
    try {
      if (el.type === 'demande') {
        if (oui) await direOui(c, el.demande.demande, el.cle, await moiPublic(c));
        vues.current = ajouterVue(dejaVues(), el.cle);
      } else if (oui) {
        await accepterOffre(c, el.cle);
        // Le choix est fait (accepterOffre oublie déjà la demande locale) : la page client repasse au gris.
        signalerChoix();
      } else {
        await refuserOffre(c, el.cle);
      }
      retirer(el.cle);
      if (el.type === 'offre' && oui) navigate(cheminBulle(el.cle));
    } catch (e) {
      if (familleErreur(e) === 'reseau') {
        setEchec({ cle: el.cle, texte: PAS_DE_RESEAU });
      } else {
        // Demande retirée, expirée ou offre déjà fermée : le bandeau s'en va.
        if (el.type === 'demande') vues.current = ajouterVue(dejaVues(), el.cle);
        retirer(el.cle);
      }
    } finally {
      setOccupe(false);
    }
  }

  const t = textes(el);
  const erreur = echec?.cle === el.cle ? echec.texte : null;
  return (
    <section className="notif" aria-label={t.nom} aria-live="polite">
      <div className="notif__carte" key={el.cle}>
        <p className="notif__ligne" ref={ligne}>
          {t.ligne}
        </p>
        <div className="notif__rangee">
          <p className={erreur ? 'notif__question notif__question--erreur' : 'notif__question'}>
            {erreur ?? t.question}
          </p>
          <button
            type="button"
            className="petit-bouton"
            disabled={occupe}
            onClick={() => void agir(false)}
          >
            Non
          </button>
          <button
            type="button"
            className="petit-bouton petit-bouton--plein"
            disabled={occupe}
            aria-busy={occupe || undefined}
            onClick={() => void agir(true)}
          >
            Oui
          </button>
        </div>
      </div>
    </section>
  );
}
