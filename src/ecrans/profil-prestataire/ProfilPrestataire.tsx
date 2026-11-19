import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
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
import { monStatutActif, publierStatut, retirerStatut } from '../../matrix/mur';
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

function exigerClient(client: MatrixClient | null): MatrixClient {
  // Client pas encore prêt : même message qu'une coupure réseau.
  if (!client)
    throw Object.assign(new Error('Client Matrix pas prêt.'), { name: 'ConnectionError' });
  return client;
}

function messageDe(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : MESSAGES.inconnue;
}

/** E5 Profil prestataire (modèle 3 « Pseudo en titre »). */
export function ProfilPrestataire() {
  const navigate = useNavigate();
  const { client } = useMatrix();
  const bulles = useBulles(client);
  const [session] = useState(lireSession);
  const [saisie, setSaisie] = useState<SaisieProfil>(() => ({
    pseudo: session ? pseudoPropose(session.userId) : '',
    metier: '',
    zone: '',
    recoit: false,
    deplace: false,
    services: LIGNES_VIDES,
  }));
  const [erreurs, setErreurs] = useState<ErreursProfil>({});
  const [bandeau, setBandeau] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  // undefined : pas encore touché SIA ici ; l'état vient alors du Mur (ou du téléphone en secours).
  const [choixVisible, setVisibleA] = useState<string | null | undefined>(undefined);
  // Ce que le bouton montre PENDANT que le serveur confirme (affichage immédiat). Quand le serveur refuse,
  // on l'enlève : l'écran retrouve tout seul l'état d'avant. null : rien n'est en route.
  const [attendu, setAttendu] = useState<{ visibleA: string | null } | null>(null);
  const [zoneSecours, setZoneSecours] = useState<string | null>(null);
  const [modifie, setModifie] = useState(false);
  const [eteint, setEteint] = useState(false);
  const [edition, setEdition] = useState(false);
  const [focus, setFocus] = useState<'pseudo' | 'metier' | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoOccupee, setPhotoOccupee] = useState(false);
  const champPseudo = useRef<HTMLInputElement>(null);
  const idPhrase = useId();
  // Faux si on a quitté la page pendant l'envoi : on ne ramène alors personne au Mur.
  const ici = useRef(false);
  useEffect(() => {
    ici.current = true;
    return () => {
      ici.current = false;
    };
  }, []);

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
              if (actif && pseudo) setSaisie((avant) => ({ ...avant, pseudo }));
            })
            .catch(() => undefined);
          return;
        }
        setSaisie(saisieDepuis(resultat.profil));
        if (lireDisponible()) setZoneSecours(resultat.profil.zone);
      });
    return () => {
      actif = false;
    };
  }, [session, navigate]);

  useEffect(() => {
    if (edition) champPseudo.current?.focus();
  }, [edition]);

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
    // Le bouton passe au vert tout de suite ; si le serveur refuse, il revient à son état d'avant.
    setAttendu({ visibleA: verifie.profil.zone });
    const resultat = await enregistrerProfil(session, verifie.profil).catch(() => ({
      ok: false as const,
      erreur: 'inconnue' as const,
    }));
    if (!resultat.ok) {
      setAttendu(null);
      if (resultat.erreur === 'session') navigate(CHEMINS.accueil, { replace: true });
      else setBandeau(MESSAGES[resultat.erreur]);
      return;
    }
    const { pseudo, metier, zone, modalite, services } = verifie.profil;
    // Profil enregistré : les écrans suivants (Mur, fiches) le savent tout de suite.
    memoriserMoi(session.userId, { role: 'prestataire', pseudo, zone });
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
      setAttendu(null);
      echecReseau(e);
      return;
    }
    try {
      ecrireDisponible(true);
    } catch {
      // Le statut est publié sur le Mur ; seul le secours du téléphone manque.
    }
    signalerDisponible();
    setModifie(false);
    setEteint(false);
    setVisibleA(verifie.profil.zone);
    setAttendu(null);
    if (ici.current) navigate(cheminMur());
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
