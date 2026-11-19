import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useGlisse } from '../../ui/useGlisse';
import { familleErreur } from '../profil-client/branchements';
import { CarteAlerte } from './CarteAlerte';
import type { VueAlerte } from './CarteAlerte';
import { commencerReponse, enFile, finirReponse, rater } from './reponses';
import { EVENEMENT_DISPONIBLE, signalerChoix } from './signal';
import { ajouterVue, lireVues } from './vues';
import './bandeau.css';

/*
 * Bandeaux M1 / M2, posés au-dessus de tout écran (appli ouverte seulement) :
 * - prestataire disponible : une demande de client arrive → « D'accord ? » Non / Oui ;
 * - client : un prestataire a dit oui → « Tu veux discuter ? » Non / Oui.
 * Les alertes s'empilent : la plus récente en haut, trois au plus à la fois ; les autres attendent.
 * Un toucher change la carte tout de suite (« Réponse envoyée… ») ; elle s'en va quand le serveur confirme.
 */

type Alerte =
  | { type: 'demande'; cle: string; demande: DemandeRecue }
  | { type: 'offre'; cle: string; bulle: ResumeBulle };

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
  const { pseudo, zone } = a.bulle.autre;
  return {
    cle: a.cle,
    nom: 'Nouvelle offre',
    ligne: `${pseudo} (${zone}) dit oui`,
    question: 'Tu veux discuter ?',
  };
}

export function Bandeau() {
  const { client } = useMatrix();
  const navigate = useNavigate();
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

  // Client : offres reçues (invitations dans une bulle).
  useEffect(() => {
    if (!client) return;
    return ecouterBulles(client, (bulles) => {
      const offres = bulles.filter((b) => b.etat === 'invitation-recue');
      const encore = new Set(offres.map((b) => b.roomId));
      setFile((f) => {
        const gardes = f.filter((x) => x.type === 'demande' || encore.has(x.cle));
        const nouvelles: Alerte[] = offres
          .filter((b) => !gardes.some((x) => x.cle === b.roomId))
          .map((b) => ({ type: 'offre', cle: b.roomId, bulle: b }));
        return nouvelles.length === 0 && gardes.length === f.length ? f : [...gardes, ...nouvelles];
      });
    });
  }, [client]);

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

  async function repondre(alerte: Alerte, oui: boolean): Promise<void> {
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
        <CarteAlerte key={a.cle} vue={vueDe(a)} onRepondre={(oui) => void repondre(a, oui)} />
      ))}
    </div>
  );
}
