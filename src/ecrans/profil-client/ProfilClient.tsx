import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { MatrixClient } from 'matrix-js-sdk';
import { CHEMINS, cheminMur } from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { TEXTE_DEMANDE_MAX, verifierDemande } from '../../logique/demande';
import type { DemandeClient, ErreursDemande } from '../../logique/demande';
import { profilClientComplet } from '../../logique/profil-client';
import type { SaisieProfilClient as SaisieClient } from '../../logique/profil-client';
import { LIMITES, formaterPrix, lirePrix, pseudoPropose } from '../../logique/profil';
import type { Session } from '../../matrix/auth';
import type { ResumeBulle } from '../../matrix/bulles';
import { publierDemande, retirerDemande } from '../../matrix/mur';
import { reglerNotificationPrestataires } from '../../matrix/notifications';
import {
  enregistrerProfilClient,
  lireProfilClient,
  lirePseudoEnregistre,
} from '../../matrix/profil';
import { lireSession } from '../../matrix/session';
import { AccesBulles } from '../../ui/AccesBulles';
import { Bandeau } from '../../ui/Bandeau';
import { BoutonDeconnexion } from '../../ui/BoutonDeconnexion';
import { BoutonSia } from '../../ui/BoutonSia';
import { ChampQuartier } from '../../ui/ChampQuartier';
import { MessageErreur } from '../../ui/MessageErreur';
import { RondInitiale } from '../../ui/RondInitiale';
import { IconeChevron, IconeCrayon } from '../../ui/icones';
import { enFile } from '../bandeau/reponses';
import { EVENEMENT_CHOISI, aChoisi, oublierChoix } from '../bandeau/signal';
import { compterNouveautes, useBulles } from '../bulles/useBulles';
import { memoriserMoi } from '../mur/useMoi';
import { familleErreur } from './branchements';
import type { ErreurReseau } from './branchements';
import {
  effacerDemandeEnCours,
  ecrireDemandeEnCours,
  lireDemandeEnCours,
} from './demande-en-cours';
import type { DemandeEnCours } from './demande-en-cours';
import { deposerEchec, ecouterEchec, reprendreEchec } from './echec-publication';
import './profil-client.css';

const MESSAGES: Record<Exclude<ErreurReseau, 'session'>, string> = {
  reseau: 'Pas de connexion. Réessaie dans un instant.',
  inconnue: 'Un problème est survenu. Réessaie.',
};

/** Prestataires qui ont dit oui à MA demande en cours (offres reçues, pas encore acceptées). */
function compterOui(bulles: readonly ResumeBulle[] | null, enCours: DemandeEnCours | null): number {
  if (!bulles || !enCours) return 0;
  return bulles.filter(
    (b) =>
      b.etat === 'invitation-recue' &&
      !b.invitationDirecte &&
      (b.demande === null || b.demande.annonce === enCours.eventId),
  ).length;
}

function exigerClient(client: MatrixClient | null): MatrixClient {
  // Client pas encore prêt : même message qu'une coupure réseau.
  if (!client)
    throw Object.assign(new Error('Client Matrix pas prêt.'), { name: 'ConnectionError' });
  return client;
}

/**
 * Retire ma demande précédente (si elle existe encore), enregistre mon profil client puis publie la nouvelle demande.
 * Rend l'erreur du serveur, ou null si la demande est publiée (et gardée sur ce téléphone pour pouvoir la retirer).
 * Rien n'est envoyé tant que le client Matrix n'est pas prêt.
 */
async function publierLaDemande(
  session: Session,
  client: MatrixClient | null,
  demande: DemandeClient,
  ancienne: DemandeEnCours | null,
): Promise<ErreurReseau | null> {
  let c: MatrixClient;
  try {
    c = exigerClient(client);
    // Relue au moment d'agir : une publication partie juste avant a pu remplacer la demande que je connaissais.
    const aRetirer = lireDemandeEnCours(Date.now()) ?? ancienne;
    if (aRetirer) {
      await retirerDemande(c, aRetirer.eventId);
      effacerDemandeEnCours();
    }
  } catch (e) {
    return familleErreur(e);
  }
  const profil = {
    version: 1,
    role: 'client',
    pseudo: demande.pseudo,
    zone: demande.zone,
  } as const;
  const enregistre = await enregistrerProfilClient(session, profil).catch(() => ({
    ok: false as const,
    erreur: 'inconnue' as const,
  }));
  if (!enregistre.ok && enregistre.erreur === 'session') return 'session';
  let eventId: string;
  try {
    eventId = await publierDemande(c, demande);
  } catch (e) {
    return familleErreur(e);
  }
  oublierChoix();
  try {
    ecrireDemandeEnCours({ eventId, demande });
  } catch {
    // Stockage plein ou bloqué : la demande reste publiée, elle expirera seule.
  }
  return null;
}

function saisieDepuisDemande(d: DemandeClient): SaisieClient {
  return {
    pseudo: d.pseudo,
    zone: d.zone,
    service: d.service,
    budget: formaterPrix(d.budget),
    texte: d.texte,
  };
}

function saisieDeDepart(userId: string, enCours: DemandeEnCours | null): SaisieClient {
  if (enCours) return saisieDepuisDemande(enCours.demande);
  return { pseudo: pseudoPropose(userId), zone: '', service: '', budget: '', texte: '' };
}

/** E6 Page client (modèle 2 « Profil + premier besoin »). */
export function ProfilClient() {
  const navigate = useNavigate();
  const { client } = useMatrix();
  const bulles = useBulles(client);
  const [session] = useState(lireSession);
  const [enCours, setEnCours] = useState(() => lireDemandeEnCours(Date.now()));
  const [saisie, setSaisie] = useState<SaisieClient>(() =>
    saisieDeDepart(session?.userId ?? '', enCours),
  );
  const [erreurs, setErreurs] = useState<ErreursDemande>({});
  const [bandeau, setBandeau] = useState<string | null>(null);
  // Ce que le bouton montre PENDANT que le serveur confirme le retrait de la demande (affichage immédiat).
  // Quand le serveur refuse, on l'enlève : l'écran retrouve tout seul l'état d'avant. null : rien n'est en route.
  const [attendu, setAttendu] = useState<'retiree' | null>(null);
  const [modifie, setModifie] = useState(false);
  const [retiree, setRetiree] = useState(false);
  const [edition, setEdition] = useState(false);
  const [focusPseudo, setFocusPseudo] = useState(false);
  const [choisi, setChoisi] = useState(aChoisi);
  const champPseudo = useRef<HTMLInputElement>(null);
  const idPhrase = useId();
  // Vrai dès que ce qui était tapé a été repris d'un refus du serveur : la copie du serveur ne doit pas l'écraser.
  const repris = useRef(false);

  // Le serveur a refusé la publication : ce qui était tapé revient tel quel, avec le message. Le refus peut être
  // arrivé avant l'ouverture de la page, ou arriver pendant qu'elle est ouverte (refus très rapide).
  useEffect(() => {
    const reprendre = () => {
      const echec = reprendreEchec();
      if (!echec) return;
      repris.current = true;
      setSaisie(echec.saisie);
      setBandeau(echec.message);
      setModifie(true);
    };
    reprendre();
    return ecouterEchec(reprendre);
  }, []);

  // Offre acceptée dans le bandeau : la demande est terminée, la page repasse au gris.
  useEffect(() => {
    const surChoix = (): void => {
      setEnCours(null);
      setModifie(false);
      setRetiree(false);
      setChoisi(true);
    };
    window.addEventListener(EVENEMENT_CHOISI, surChoix);
    return () => window.removeEventListener(EVENEMENT_CHOISI, surChoix);
  }, []);

  useEffect(() => {
    if (edition) champPseudo.current?.focus();
  }, [edition]);

  // Pseudo et quartier enregistrés sur le serveur (sauf si une demande en cours les donne déjà).
  useEffect(() => {
    if (!session || lireDemandeEnCours(Date.now())) return;
    let actif = true;
    lireProfilClient(session)
      .then((lu) => {
        if (!actif) return;
        if (!lu.ok) {
          if (lu.erreur === 'session') navigate(CHEMINS.accueil, { replace: true });
          return;
        }
        // Après un refus : on garde ce qui était tapé, pas la copie du serveur.
        if (repris.current) return;
        const profil = lu.profil;
        if (profil) {
          setSaisie((avant) => ({ ...avant, pseudo: profil.pseudo, zone: profil.zone }));
          return;
        }
        // Pas de profil client : on reprend le pseudo déjà choisi (par exemple en prestataire).
        lirePseudoEnregistre(session)
          .then((pseudo) => {
            if (actif && pseudo && !repris.current) setSaisie((avant) => ({ ...avant, pseudo }));
          })
          .catch(() => undefined);
      })
      .catch(() => undefined); // Profil illisible : on garde le pseudo proposé.
    return () => {
      actif = false;
    };
  }, [session, navigate]);

  if (!session) return <Navigate to={CHEMINS.accueil} replace />;

  const envoi = attendu !== null;
  const allume = attendu === null && enCours !== null;

  function modifier(champ: keyof SaisieClient, valeur: string) {
    setSaisie((avant) => ({ ...avant, [champ]: valeur }));
    setErreurs((avant) => (avant[champ] ? { ...avant, [champ]: undefined } : avant));
    setModifie(true);
    setRetiree(false);
    setChoisi(false);
  }

  function echec(e: unknown) {
    const famille = familleErreur(e);
    if (famille === 'session') navigate(CHEMINS.accueil, { replace: true });
    else setBandeau(MESSAGES[famille]);
  }

  async function retirer(): Promise<boolean> {
    if (!session || !enCours) return true;
    try {
      await retirerDemande(exigerClient(client), enCours.eventId);
    } catch (e) {
      echec(e);
      return false;
    }
    effacerDemandeEnCours();
    setEnCours(null);
    return true;
  }

  async function publier() {
    if (!session) return;
    const verifie = verifierDemande(saisie, Date.now());
    if (!verifie.ok) {
      setErreurs(verifie.erreurs);
      return;
    }
    const demande = verifie.demande;
    // Les écrans suivants (Mur, fiches) savent tout de suite qui je suis, sans attendre le serveur.
    memoriserMoi(session.userId, { role: 'client', pseudo: demande.pseudo, zone: demande.zone });
    // Dès la première demande : prévenu quand un prestataire se rend disponible (sans attendre la prochaine ouverture).
    if (client) void reglerNotificationPrestataires(client, true);
    // Au Mur dès le toucher. Le serveur travaille derrière ; s'il refuse, on revient ici avec ce qui était tapé.
    navigate(cheminMur());
    const erreur = await enFile(() => publierLaDemande(session, client, demande, enCours));
    if (erreur === null) return;
    if (erreur === 'session') {
      navigate(CHEMINS.accueil, { replace: true });
      return;
    }
    deposerEchec({ message: MESSAGES[erreur], saisie });
    navigate(CHEMINS.profilClient);
  }

  async function toucherSia() {
    if (envoi) return;
    setBandeau(null);
    if (allume && !modifie) {
      // Le bouton repasse au gris tout de suite ; si le serveur refuse, il redevient vert avec un message.
      setAttendu('retiree');
      if (await retirer()) setRetiree(true);
      setAttendu(null);
    } else {
      await publier();
    }
  }

  function arrondirBudget() {
    const lu = lirePrix(saisie.budget);
    if (lu !== null && formaterPrix(lu) !== saisie.budget) {
      setSaisie((avant) => ({ ...avant, budget: formaterPrix(lu) }));
    }
  }

  function quitterTitre(e: FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) setEdition(false);
  }

  function valider(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
  }

  const pseudoEnSaisie = edition || focusPseudo || saisie.pseudo.trim() === '';

  // La phrase suit le bouton, sans attendre le serveur (« Ta demande est retirée. » dès le toucher).
  let phrase = '';
  if (attendu === 'retiree') phrase = 'Ta demande est retirée.';
  else if (allume && modifie) phrase = 'Touche SIA pour envoyer ta nouvelle demande.';
  else if (allume) phrase = 'Ta demande est partie.';
  else if (retiree) phrase = 'Ta demande est retirée.';
  else if (choisi) phrase = 'Tu as choisi.';

  const nbOui = compterOui(bulles, enCours);
  const texteOui = nbOui === 1 ? '1 prestataire a dit oui' : `${nbOui} prestataires ont dit oui`;

  return (
    <main className="ecran client">
      <h1 className="masque">Ton profil</h1>
      <AccesBulles nouveautes={compterNouveautes(bulles)} />
      <div className="client__espace client__espace--haut" />
      <div className="client__entete">
        <RondInitiale nom={saisie.pseudo} />
        <div className="client__titre" onBlur={quitterTitre}>
          {pseudoEnSaisie ? (
            <input
              ref={champPseudo}
              className="client__saisie-pseudo"
              aria-label="Ton pseudo"
              placeholder="Ton pseudo"
              maxLength={LIMITES.pseudo}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={saisie.pseudo}
              aria-invalid={erreurs.pseudo ? true : undefined}
              onChange={(e) => modifier('pseudo', e.target.value)}
              onFocus={() => setFocusPseudo(true)}
              onBlur={() => setFocusPseudo(false)}
              onKeyDown={valider}
            />
          ) : (
            <p className="client__pseudo">{saisie.pseudo}</p>
          )}
          <p className="client__role">Client</p>
        </div>
        <button
          type="button"
          className="client__crayon"
          aria-label="Modifier mon pseudo"
          onClick={() => {
            setEdition(true);
            champPseudo.current?.focus();
          }}
        >
          <IconeCrayon />
        </button>
      </div>
      {erreurs.pseudo && (
        <div className="client__erreur-centre">
          <MessageErreur message={erreurs.pseudo} />
        </div>
      )}

      <div className="client__espace client__espace--1" />
      <ChampQuartier
        valeur={saisie.zone}
        onChange={(v) => modifier('zone', v)}
        erreur={erreurs.zone}
        maxLength={LIMITES.zone}
      />

      <div className="client__espace client__espace--2" />
      <div className="client__bloc">
        <label className="client__etiquette" htmlFor={`${idPhrase}-service`}>
          De quoi as-tu besoin ?
        </label>
        <input
          id={`${idPhrase}-service`}
          className="champ__saisie"
          placeholder="Ex. plombier"
          maxLength={LIMITES.service}
          value={saisie.service}
          aria-invalid={erreurs.service ? true : undefined}
          onChange={(e) => modifier('service', e.target.value)}
        />
        {erreurs.service && <MessageErreur message={erreurs.service} />}
      </div>

      <div className="client__espace client__espace--3" />
      <div className="client__bloc">
        <label className="client__etiquette" htmlFor={`${idPhrase}-budget`}>
          Ton budget
        </label>
        <div className="client__budget">
          <input
            id={`${idPhrase}-budget`}
            className="champ__saisie client__saisie-budget"
            aria-label="Ton budget, en FCFA"
            placeholder="Montant"
            inputMode="numeric"
            autoComplete="off"
            value={saisie.budget}
            aria-invalid={erreurs.budget ? true : undefined}
            onChange={(e) => modifier('budget', e.target.value)}
            onBlur={arrondirBudget}
          />
          <span className="client__devise" aria-hidden="true">
            FCFA
          </span>
        </div>
        {erreurs.budget && <MessageErreur message={erreurs.budget} />}
      </div>

      <div className="client__espace client__espace--4" />
      <div className="client__bloc">
        <input
          className="champ__saisie"
          aria-label="Précise ton besoin (facultatif)"
          placeholder="Précise ton besoin (facultatif)"
          maxLength={TEXTE_DEMANDE_MAX}
          value={saisie.texte}
          aria-invalid={erreurs.texte ? true : undefined}
          onChange={(e) => modifier('texte', e.target.value)}
        />
        {erreurs.texte && <MessageErreur message={erreurs.texte} />}
      </div>

      <div className="client__espace client__espace--5">
        {nbOui > 0 && (
          <Link className="client__oui" to={CHEMINS.bulles}>
            <span className="client__point" aria-hidden="true" />
            {texteOui}
            <IconeChevron className="client__chevron" />
          </Link>
        )}
      </div>
      <div className="client__bas">
        {bandeau && <Bandeau message={bandeau} />}
        <BoutonSia
          allume={allume}
          actif={profilClientComplet(saisie) || allume}
          chargement={envoi}
          idPhrase={idPhrase}
          onClick={() => void toucherSia()}
        />
        <p id={idPhrase} className="client__phrase" aria-live="polite">
          {phrase}
        </p>
      </div>
      <div className="client__espace client__espace--bas" />
      <BoutonDeconnexion />
    </main>
  );
}
