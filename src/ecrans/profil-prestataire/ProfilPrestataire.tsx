import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { MatrixClient } from 'matrix-js-sdk';
import { CHEMINS, cheminMur } from '../../chemins';
import { DUREE_MAX_ANNONCE_MS } from '../../config';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import {
  LIMITES,
  choixDepuisModalite,
  formaterPrix,
  profilComplet,
  pseudoPropose,
  verifierProfil,
} from '../../logique/profil';
import type {
  ErreursProfil,
  ProfilPrestataire as Profil,
  SaisieProfil,
} from '../../logique/profil';
import type { Session } from '../../matrix/auth';
import { monStatutActif, publierStatut, retirerStatut } from '../../matrix/mur';
import { reglerNotificationDemandes } from '../../matrix/notifications';
import { enregistrerProfil, lireProfil, lirePseudoEnregistre } from '../../matrix/profil';
import type { ErreurProfil } from '../../matrix/profil';
import { lireSession } from '../../matrix/session';
import { ecrireDisponible, lireDisponible } from '../../appareil/disponible';
import { effacerPhoto, enregistrerPhoto, lirePhoto, preparerPhoto } from '../../appareil/photo';
import { AccesBulles } from '../../ui/AccesBulles';
import { Avatar } from '../../ui/Avatar';
import { Bandeau } from '../../ui/Bandeau';
import { BoutonDeconnexion } from '../../ui/BoutonDeconnexion';
import { BoutonSia } from '../../ui/BoutonSia';
import { ChampQuartier } from '../../ui/ChampQuartier';
import { LigneService } from '../../ui/LigneService';
import { MessageErreur } from '../../ui/MessageErreur';
import { PastilleChoix } from '../../ui/PastilleChoix';
import { IconeCrayon } from '../../ui/icones';
import { enFile } from '../bandeau/reponses';
import { signalerDisponible } from '../bandeau/signal';
import { compterNouveautes, useBulles } from '../bulles/useBulles';
import { memoriserMoi } from '../mur/useMoi';
import { familleErreur } from '../profil-client/branchements';
import './profil-prestataire.css';

const NB_LIGNES_SERVICE = 2;
const LIGNES_VIDES = Array.from({ length: NB_LIGNES_SERVICE }, () => ({ label: '', prix: '' }));

const MESSAGES: Record<Exclude<ErreurProfil, 'session'>, string> = {
  reseau: 'Pas de connexion. Réessaie dans un instant.',
  inconnue: 'Un problème est survenu. Réessaie.',
};

function saisieDepuis(profil: Profil): SaisieProfil {
  const lignes = profil.services.map((s) => ({ label: s.label, prix: formaterPrix(s.prix) }));
  return {
    pseudo: profil.pseudo,
    metier: profil.metier,
    zone: profil.zone,
    ...choixDepuisModalite(profil.modalite),
    services: [...lignes, ...LIGNES_VIDES].slice(0, Math.max(NB_LIGNES_SERVICE, lignes.length)),
  };
}

/** Ce qu'on rapporte au profil quand le serveur a refusé la mise en ligne : le message et ce qui était tapé. */
type Echec = { message: string; saisie: SaisieProfil };

/** Relit l'échec passé dans l'état de navigation (inconnu au départ : on vérifie sa forme). */
function echecDepuis(etat: unknown): Echec | null {
  if (typeof etat !== 'object' || etat === null || !('echec' in etat)) return null;
  const { echec } = etat;
  if (typeof echec !== 'object' || echec === null) return null;
  const { message, saisie } = echec as Partial<Echec>;
  return typeof message === 'string' && typeof saisie === 'object' && saisie !== null
    ? { message, saisie }
    : null;
}

function exigerClient(client: MatrixClient | null): MatrixClient {
  // Client pas encore prêt : même message qu'une coupure réseau.
  if (!client)
    throw Object.assign(new Error('Client Matrix pas prêt.'), { name: 'ConnectionError' });
  return client;
}

function messageDe(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : MESSAGES.inconnue;
}

/** Enregistre le profil puis publie le statut sur le Mur. Rend l'erreur du serveur, ou null si tout est en ligne. */
async function mettreEnLigne(
  session: Session,
  client: MatrixClient | null,
  profil: Profil,
): Promise<ErreurProfil | null> {
  const enregistre = await enregistrerProfil(session, profil).catch(() => ({
    ok: false as const,
    erreur: 'inconnue' as const,
  }));
  if (!enregistre.ok) return enregistre.erreur;
  const { pseudo, metier, zone, modalite, services } = profil;
  try {
    await publierStatut(exigerClient(client), {
      pseudo,
      metier,
      zone,
      modalite,
      ...(services.length > 0 ? { services } : {}),
      fin: Date.now() + DUREE_MAX_ANNONCE_MS,
    });
  } catch (e) {
    return familleErreur(e);
  }
  try {
    ecrireDisponible(true);
  } catch {
    // Le statut est publié sur le Mur ; seul le secours du téléphone manque.
  }
  // Disponible : prévenir (même appli fermée) quand un client pose une demande.
  if (client) void reglerNotificationDemandes(client, true);
  signalerDisponible();
  return null;
}

/** E5 Profil prestataire (modèle 3 « Pseudo en titre »). */
export function ProfilPrestataire() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { client } = useMatrix();
  const bulles = useBulles(client);
  const [session] = useState(lireSession);
  // On revient ici parce que le serveur a refusé : ce qui était tapé est rendu tel quel, avec le message.
  const [echec] = useState(() => echecDepuis(state));
  const [saisie, setSaisie] = useState<SaisieProfil>(
    () =>
      echec?.saisie ?? {
        pseudo: session ? pseudoPropose(session.userId) : '',
        metier: '',
        zone: '',
        recoit: false,
        deplace: false,
        services: LIGNES_VIDES,
      },
  );
  const [erreurs, setErreurs] = useState<ErreursProfil>({});
  const [bandeau, setBandeau] = useState<string | null>(echec?.message ?? null);
  const [chargement, setChargement] = useState(true);
  // undefined : pas encore touché SIA ici ; l'état vient alors du Mur (ou du téléphone en secours).
  const [choixVisible, setVisibleA] = useState<string | null | undefined>(undefined);
  // Ce que le bouton montre PENDANT que le serveur confirme (affichage immédiat). Quand le serveur refuse,
  // on l'enlève : l'écran retrouve tout seul l'état d'avant. null : rien n'est en route.
  const [attendu, setAttendu] = useState<{ visibleA: string | null } | null>(null);
  const [zoneSecours, setZoneSecours] = useState<string | null>(null);
  const [modifie, setModifie] = useState(echec !== null);
  const [eteint, setEteint] = useState(false);
  const [edition, setEdition] = useState(false);
  const [focus, setFocus] = useState<'pseudo' | 'metier' | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoOccupee, setPhotoOccupee] = useState(false);
  const champPseudo = useRef<HTMLInputElement>(null);
  const idPhrase = useId();

  const urlPhoto = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(
    () => () => {
      if (urlPhoto) URL.revokeObjectURL(urlPhoto);
    },
    [urlPhoto],
  );

  useEffect(() => {
    if (!session) return;
    let actif = true;
    lirePhoto()
      .then((p) => actif && setPhoto(p))
      .catch(() => undefined); // Pas de photo lisible : on garde le rond vide.
    lireProfil(session)
      .catch(() => ({ ok: false as const, erreur: 'inconnue' as const }))
      .then((resultat) => {
        if (!actif) return;
        setChargement(false);
        if (!resultat.ok) {
          if (resultat.erreur === 'session') navigate(CHEMINS.accueil, { replace: true });
          else setBandeau(MESSAGES[resultat.erreur]);
          return;
        }
        if (!resultat.profil) {
          // Pas de profil prestataire : on reprend le pseudo déjà choisi (par exemple en client).
          lirePseudoEnregistre(session)
            .then((pseudo) => {
              if (actif && pseudo && !echec) setSaisie((avant) => ({ ...avant, pseudo }));
            })
            .catch(() => undefined);
          return;
        }
        // Retour après un refus : on garde ce qui était tapé, pas la copie du serveur.
        if (!echec) setSaisie(saisieDepuis(resultat.profil));
        if (lireDisponible()) setZoneSecours(resultat.profil.zone);
      });
    return () => {
      actif = false;
    };
  }, [session, navigate, echec]);

  useEffect(() => {
    if (edition) champPseudo.current?.focus();
  }, [edition]);

  // L'échec est lu : on le retire de l'historique, pour qu'un retour arrière ne ramène pas un vieux message.
  useEffect(() => {
    if (echec) navigate(CHEMINS.profilPrestataire, { replace: true, state: null });
  }, [echec, navigate]);

  if (!session) return <Navigate to={CHEMINS.accueil} replace />;

  const statut = client ? monStatutActif(client) : null;
  const reel = choixVisible !== undefined ? choixVisible : (statut?.statut.zone ?? zoneSecours);
  const envoi = attendu !== null;
  const visibleA = attendu ? attendu.visibleA : reel;
  const allume = visibleA !== null;
  const complet = profilComplet(saisie);

  function modifier<K extends keyof SaisieProfil>(champ: K, valeur: SaisieProfil[K]) {
    setSaisie((avant) => ({ ...avant, [champ]: valeur }));
    const cle: keyof ErreursProfil =
      champ === 'recoit' || champ === 'deplace' ? 'modalite' : (champ as keyof ErreursProfil);
    setErreurs((avant) => (avant[cle] ? { ...avant, [cle]: undefined } : avant));
    setModifie(true);
    setEteint(false);
  }

  function modifierService(index: number, partie: 'label' | 'prix', valeur: string) {
    modifier(
      'services',
      saisie.services.map((l, i) => (i === index ? { ...l, [partie]: valeur } : l)),
    );
  }

  function echecReseau(e: unknown) {
    const famille = familleErreur(e);
    if (famille === 'session') navigate(CHEMINS.accueil, { replace: true });
    else setBandeau(MESSAGES[famille]);
  }

  /** Le bouton repasse au gris tout de suite ; si le serveur refuse, il redevient vert avec un message. */
  async function eteindre() {
    setAttendu({ visibleA: null });
    try {
      await retirerStatut(exigerClient(client));
    } catch (e) {
      setAttendu(null);
      echecReseau(e);
      return;
    }
    try {
      ecrireDisponible(false);
    } catch {
      // Le Mur est à jour ; seul le secours du téléphone n'a pas pu être écrit.
    }
    // Plus disponible : plus de notification pour les demandes des clients.
    if (client) void reglerNotificationDemandes(client, false);
    setVisibleA(null);
    setEteint(true);
    setAttendu(null);
  }

  async function toucherSia() {
    if (envoi || !session) return;
    setBandeau(null);
    if (allume && !modifie) {
      await eteindre();
      return;
    }
    const verifie = verifierProfil(saisie);
    if (!verifie.ok) {
      setErreurs(verifie.erreurs);
      return;
    }
    const { pseudo, zone } = verifie.profil;
    // Les écrans suivants (Mur, fiches) savent tout de suite qui je suis, sans attendre le serveur.
    memoriserMoi(session.userId, { role: 'prestataire', pseudo, zone });
    // Au Mur dès le toucher. Le serveur travaille derrière ; s'il refuse, on revient ici avec ce qui était tapé.
    navigate(cheminMur());
    const erreur = await enFile(() => mettreEnLigne(session, client, verifie.profil));
    if (erreur === null) return;
    if (erreur === 'session') navigate(CHEMINS.accueil, { replace: true });
    else
      navigate(CHEMINS.profilPrestataire, {
        state: { echec: { message: MESSAGES[erreur], saisie } },
      });
  }

  async function choisirPhoto(fichier: File) {
    setPhotoOccupee(true);
    try {
      const prete = await preparerPhoto(fichier);
      await enregistrerPhoto(prete);
      setPhoto(prete);
      setBandeau(null);
    } catch (e) {
      setBandeau(messageDe(e));
    } finally {
      setPhotoOccupee(false);
    }
  }

  async function retirerPhoto() {
    try {
      await effacerPhoto();
      setPhoto(null);
    } catch (e) {
      setBandeau(messageDe(e));
    }
  }

  function quitterTitre(e: FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) setEdition(false);
  }

  function valider(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
  }

  const pseudoEnSaisie = edition || focus === 'pseudo' || saisie.pseudo.trim() === '';
  const metierEnSaisie = edition || focus === 'metier' || saisie.metier.trim() === '';

  // La phrase suit le bouton, sans attendre le serveur (« Tu es visible… » dès le toucher).
  let phrase = '';
  if (allume && modifie && !envoi) phrase = 'Touche SIA pour enregistrer.';
  else if (allume) phrase = `Tu es visible à ${visibleA}.`;
  else if (eteint || envoi) phrase = "Tu n'es plus visible.";

  const erreurTitre = erreurs.pseudo ?? erreurs.metier;

  return (
    <main className="ecran profil">
      <h1 className="masque">Ton profil</h1>
      <AccesBulles nouveautes={compterNouveautes(bulles)} />
      <fieldset className="profil__formulaire" disabled={chargement}>
        <div className="profil__espace profil__espace--haut" />
        <div className="profil__entete">
          <Avatar
            url={urlPhoto}
            occupe={photoOccupee}
            onChoisir={(f) => void choisirPhoto(f)}
            onRetirer={() => void retirerPhoto()}
          />
          <div className="profil__titre" onBlur={quitterTitre}>
            {pseudoEnSaisie ? (
              <input
                ref={champPseudo}
                className="profil__saisie profil__saisie--pseudo"
                aria-label="Ton pseudo"
                placeholder="Ton pseudo"
                maxLength={LIMITES.pseudo}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={saisie.pseudo}
                aria-invalid={erreurs.pseudo ? true : undefined}
                onChange={(e) => modifier('pseudo', e.target.value)}
                onFocus={() => setFocus('pseudo')}
                onBlur={() => setFocus(null)}
                onKeyDown={valider}
              />
            ) : (
              <p className="profil__pseudo">{saisie.pseudo}</p>
            )}
            {metierEnSaisie ? (
              <input
                className="profil__saisie profil__saisie--metier"
                aria-label="Ton métier"
                placeholder="Ton métier (ex. plombier)"
                maxLength={LIMITES.metier}
                value={saisie.metier}
                aria-invalid={erreurs.metier ? true : undefined}
                onChange={(e) => modifier('metier', e.target.value)}
                onFocus={() => setFocus('metier')}
                onBlur={() => setFocus(null)}
                onKeyDown={valider}
              />
            ) : (
              <p className="profil__metier">{saisie.metier}</p>
            )}
          </div>
          <button
            type="button"
            className="profil__crayon"
            aria-label="Modifier mon pseudo et mon métier"
            onClick={() => {
              setEdition(true);
              champPseudo.current?.focus();
            }}
          >
            <IconeCrayon />
          </button>
        </div>
        {erreurTitre && (
          <div className="profil__erreur-centre">
            <MessageErreur message={erreurTitre} />
          </div>
        )}

        <div className="profil__espace profil__espace--1" />
        <div role="group" aria-label="Comment tu travailles">
          <div className="profil__choix">
            <PastilleChoix
              libelle="Je reçois"
              choisie={saisie.recoit}
              onChange={(v) => modifier('recoit', v)}
            />
            <PastilleChoix
              libelle="Je me déplace"
              choisie={saisie.deplace}
              onChange={(v) => modifier('deplace', v)}
            />
          </div>
          {erreurs.modalite && <MessageErreur message={erreurs.modalite} />}
        </div>

        <div className="profil__espace profil__espace--2" />
        <ChampQuartier
          valeur={saisie.zone}
          onChange={(v) => modifier('zone', v)}
          erreur={erreurs.zone}
          maxLength={LIMITES.zone}
        />

        <div className="profil__espace profil__espace--3" />
        <div className="profil__services" role="group" aria-label="Tes services et leurs prix">
          {saisie.services.map((ligne, i) => (
            <LigneService
              key={i}
              numero={i + 1}
              nom={ligne.label}
              prix={ligne.prix}
              maxNom={LIMITES.service}
              invalide={Boolean(erreurs.services)}
              idErreur={`${idPhrase}-services`}
              onNom={(v) => modifierService(i, 'label', v)}
              onPrix={(v) => modifierService(i, 'prix', v)}
            />
          ))}
          {erreurs.services && (
            <MessageErreur id={`${idPhrase}-services`} message={erreurs.services} />
          )}
        </div>

        <div className="profil__espace profil__espace--4" />
        <div className="profil__bas">
          {bandeau && <Bandeau message={bandeau} />}
          <BoutonSia
            allume={allume}
            actif={!chargement && (complet || allume)}
            chargement={envoi}
            idPhrase={idPhrase}
            onClick={() => void toucherSia()}
          />
          <p id={idPhrase} className="profil__phrase" aria-live="polite">
            {phrase}
          </p>
        </div>
        <div className="profil__espace profil__espace--bas" />
        <BoutonDeconnexion />
      </fieldset>
    </main>
  );
}
