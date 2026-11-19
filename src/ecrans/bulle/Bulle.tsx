import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useNavigate, useParams } from 'react-router-dom';
import { CHEMINS } from '../../chemins';
import { DUREE_MESSAGE_MS } from '../../config';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { formaterPrix } from '../../logique/profil';
import { pseudoDe } from '../../matrix/annuaire';
import {
  ErreurEnvoiBulle,
  LONGUEUR_MAX_MESSAGE,
  accepterNouvelAppareil,
  bulleSaine,
  envoyerMessage,
  prechaufferBulle,
  reessayerMessage,
  signalerEcriture,
  silenceRadio,
  surveillerBulle,
} from '../../matrix/bulles';
import type { ResumeBulle } from '../../matrix/bulles';
import { marquerAffiche } from '../../matrix/ephemere';
import { Bandeau } from '../../ui/Bandeau';
import { FeuilleConfirmation } from '../../ui/FeuilleConfirmation';
import { RondInitiale } from '../../ui/RondInitiale';
import { IconeChevron, IconeEnvoyer, IconeRetour } from '../../ui/icones';
import { familleErreur } from '../profil-client/branchements';
import { useBulles } from '../bulles/useBulles';
import { EnregistrerClient } from './EnregistrerClient';
import { autreDeLaBulle, tempsRestant, useMessages } from './messages';
import type { Message } from './messages';
import './bulle.css';

/** « En train d'écrire » renvoyé au plus toutes les 3 s pendant la frappe. */
const RAPPEL_ECRITURE_MS = 3000;
const PAS_DE_RESEAU = 'Pas de connexion. Réessaie dans un instant.';
const PROBLEME = 'Un problème est survenu. Réessaie.';
const PAS_SURE = "Cette bulle n'est pas sûre. Elle a été fermée.";
/** Le temps de lire « pas sûre » avant le retour au Mur. */
const RETOUR_PAS_SURE_MS = 3000;

function estNouvelAppareil(e: unknown): boolean {
  return e instanceof ErreurEnvoiBulle && e.code === 'nouvel-appareil';
}

/** Le message est déjà dans le fil, marqué « pas envoyé » : pas de bandeau en plus. */
function estPasEnvoye(e: unknown): boolean {
  return e instanceof ErreurEnvoiBulle && e.code === 'pas-envoye';
}

function messageErreur(e: unknown): string {
  return familleErreur(e) === 'reseau' ? PAS_DE_RESEAU : PROBLEME;
}

/** « 7 000 » ne se coupe pas en fin de ligne (espace insécable entre les milliers). */
function garderMontants(texte: string): string {
  return texte.replace(/(\d) (?=\d{3}\b)/g, '$1\u00a0');
}

/** Sous mon message : « envoi… » pendant l'envoi, « pas envoyé » (touchable) en cas d'échec. */
function EtatEnvoiMessage({ message, onReessayer }: { message: Message; onReessayer: () => void }) {
  if (!message.moi || message.envoi === 'confirme') return null;
  if (message.envoi === 'en-cours') {
    return <span className="message__envoi">envoi…</span>;
  }
  return (
    <button type="button" className="message__echec" onClick={onReessayer}>
      pas envoyé, toucher pour réessayer
    </button>
  );
}

/** Un message ; la fine barre se vide jusqu'à son effacement (1 minute après affichage). */
function BulleMessage({
  c,
  roomId,
  message,
  onReessayer,
}: {
  c: MatrixClient;
  roomId: string;
  message: Message;
  onReessayer: (id: string) => void;
}) {
  const [reste] = useState(() => tempsRestant(message.id, Date.now()));
  const { id, moi } = message;
  // Seulement quand le message change vraiment : le fil refait un objet tout neuf à chaque nouveau message.
  useEffect(() => {
    if (!moi) marquerAffiche(c, roomId, id);
  }, [c, roomId, id, moi]);

  const style = {
    '--reste': reste / DUREE_MESSAGE_MS,
    animationDuration: `${reste}ms`,
  } as CSSProperties;
  return (
    <li className={message.moi ? 'message message--moi' : 'message'}>
      <span className="masque">{message.moi ? 'Toi : ' : 'Message : '}</span>
      <p className="message__texte">{garderMontants(message.texte)}</p>
      <span className="message__piste" aria-hidden="true">
        <span className="message__temps" style={style} />
      </span>
      <EtatEnvoiMessage message={message} onReessayer={() => onReessayer(message.id)} />
    </li>
  );
}

function sousTitre(b: ResumeBulle | null): { texte: string; vif: boolean } {
  if (b?.etat === 'ouverte' && b.autreEcrit) return { texte: "en train d'écrire…", vif: true };
  return { texte: '', vif: false };
}

function LaDemande({ bulle }: { bulle: ResumeBulle }) {
  const [ouverte, setOuverte] = useState(true);
  const d = bulle.demande;
  if (!d) return null;
  return (
    <section className={ouverte ? 'demande' : 'demande demande--repliee'} aria-label="La demande">
      <button
        type="button"
        className="demande__entete"
        aria-expanded={ouverte}
        onClick={() => setOuverte((o) => !o)}
      >
        <span className="demande__titre">La demande</span>
        <IconeChevron className="demande__chevron" />
      </button>
      {ouverte && (
        <div className="demande__corps">
          <p className="demande__resume">
            {d.service} · {d.zone} · {formaterPrix(d.budget)} FCFA
          </p>
          {d.texte && <p className="demande__texte">{d.texte}</p>}
        </div>
      )}
    </section>
  );
}

/** M4 Dans la bulle. */
export function Bulle() {
  const navigate = useNavigate();
  const { roomId = '' } = useParams();
  const { client, etat } = useMatrix();
  const bulles = useBulles(client);
  const messages = useMessages(client, roomId);
  const [texte, setTexte] = useState('');
  const [bandeau, setBandeau] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [effacement, setEffacement] = useState(false);
  const [erreurSilence, setErreurSilence] = useState<string | null>(null);
  /** Envoi bloqué par un nouvel appareil : texte à envoyer, ou `id` du message à réessayer. */
  const [appareil, setAppareil] = useState<{
    corps: string;
    erreur: string | null;
    id?: string;
  } | null>(null);
  const [acceptation, setAcceptation] = useState(false);
  const dernierSignal = useRef(0);
  const fin = useRef<HTMLDivElement>(null);

  const bulle = bulles?.find((b) => b.roomId === roomId) ?? null;
  const fermee = bulle?.etat === 'fermee';
  const attente = bulle?.etat === 'en-attente';
  // Bulle reconnue ET bien à 2 (sinon : pas de messages, pas de compte à rebours).
  const saine = client !== null && bulle !== null && bulleSaine(client, roomId);
  const pasSure = bulle !== null && !fermee && !saine;
  const peutEcrire = saine && bulle?.etat === 'ouverte';
  const autreId = client ? autreDeLaBulle(client, roomId) : null;
  const pseudo = (autreId ? pseudoDe(autreId) : null) ?? bulle?.autre.pseudo ?? null;

  useEffect(() => {
    if (!pasSure) return;
    const minuterie = setTimeout(
      () => navigate(CHEMINS.mur, { replace: true }),
      RETOUR_PAS_SURE_MS,
    );
    return () => clearTimeout(minuterie);
  }, [pasSure, navigate]);

  // Vérifications lourdes (chiffrement, 2 membres, appareils) faites à l'ouverture, puis à chaque changement.
  useEffect(() => {
    if (!client || !saine) return;
    return surveillerBulle(client, roomId);
  }, [client, roomId, saine]);

  useEffect(() => {
    fin.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length]);

  // En quittant la bulle : on n'écrit plus.
  useEffect(() => {
    if (!client || !peutEcrire) return;
    return () => {
      void signalerEcriture(client, roomId, false).catch(() => undefined);
    };
  }, [client, roomId, peutEcrire]);

  function ecrire(valeur: string) {
    setTexte(valeur);
    if (!client || !peutEcrire) return;
    const maintenant = Date.now();
    const vide = valeur.trim() === '';
    if (!vide && maintenant - dernierSignal.current < RAPPEL_ECRITURE_MS) return;
    dernierSignal.current = vide ? 0 : maintenant;
    void signalerEcriture(client, roomId, !vide).catch(() => undefined);
    // 1re frappe (puis au plus toutes les 3 s) : le chiffrement se prépare pendant qu'on écrit.
    if (!vide) prechaufferBulle(client, roomId);
  }

  /** Échec avant l'envoi : le texte revient dans le champ (s'il est resté vide). */
  function echecEnvoi(erreur: unknown, corps: string) {
    if (estPasEnvoye(erreur)) return;
    setTexte((actuel) => (actuel === '' ? corps : actuel));
    if (estNouvelAppareil(erreur)) setAppareil({ corps, erreur: null });
    else setBandeau(messageErreur(erreur));
  }

  /** Le champ se vide tout de suite ; le message s'affiche aussitôt (écho local, « envoi… »). */
  function envoyer(e?: FormEvent) {
    e?.preventDefault();
    const corps = texte.trim();
    if (!client || !peutEcrire || corps === '') return;
    setTexte('');
    setBandeau(null);
    dernierSignal.current = 0;
    void signalerEcriture(client, roomId, false).catch(() => undefined);
    void envoyerMessage(client, roomId, corps).catch((erreur: unknown) =>
      echecEnvoi(erreur, corps),
    );
  }

  /** Entrée envoie (sauf pendant une saisie en cours de composition du clavier). */
  function toucheChamp(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    envoyer();
  }

  function reessayer(id: string) {
    if (!client || !peutEcrire) return;
    setBandeau(null);
    void reessayerMessage(client, roomId, id).catch((erreur: unknown) => {
      if (estNouvelAppareil(erreur)) setAppareil({ corps: '', erreur: null, id });
      else if (!estPasEnvoye(erreur)) setBandeau(messageErreur(erreur));
    });
  }

  /** L'autre a un nouvel appareil : l'utilisateur lui fait confiance, on accepte puis on renvoie. */
  async function continuerAppareil() {
    if (!client || !appareil || acceptation) return;
    setAcceptation(true);
    try {
      await accepterNouvelAppareil(client, roomId);
      const envoi =
        appareil.id === undefined
          ? envoyerMessage(client, roomId, appareil.corps)
          : reessayerMessage(client, roomId, appareil.id);
      if (appareil.id === undefined) setTexte('');
      setAppareil(null);
      dernierSignal.current = 0;
      void signalerEcriture(client, roomId, false).catch(() => undefined);
      await envoi.catch((erreur: unknown) => {
        if (!estPasEnvoye(erreur)) throw erreur;
      });
    } catch (erreur) {
      setAppareil({ ...appareil, erreur: messageErreur(erreur) });
    } finally {
      setAcceptation(false);
    }
  }

  async function faireSilence() {
    if (!client || effacement) return;
    setEffacement(true);
    setErreurSilence(null);
    try {
      await silenceRadio(client, roomId);
      navigate(CHEMINS.mur, { replace: true });
    } catch (erreur) {
      setErreurSilence(messageErreur(erreur));
      setEffacement(false);
    }
  }

  const sous = sousTitre(bulle);
  const introuvable = client !== null && bulles !== null && bulle === null;

  return (
    <main className="bulle">
      <header className="bulle__entete">
        <button
          type="button"
          className="retour bulle__retour"
          aria-label="Le Mur"
          onClick={() => navigate(CHEMINS.mur)}
        >
          <IconeRetour />
        </button>
        {pseudo && <RondInitiale nom={pseudo} taille="petit" />}
        <div className="bulle__qui">
          <h1 className="bulle__pseudo">{pseudo ?? 'Bulle'}</h1>
          {sous.texte && (
            <p className={sous.vif ? 'bulle__sous bulle__sous--vif' : 'bulle__sous'}>
              {sous.texte}
            </p>
          )}
        </div>
        {bulle && saine && !fermee && bulle.etat !== 'invitation-recue' && (
          <button type="button" className="bulle__silence" onClick={() => setConfirmation(true)}>
            Silence Radio
          </button>
        )}
      </header>

      <div className="bulle__fil">
        {etat === 'erreur-reseau' && <Bandeau message={PAS_DE_RESEAU} />}
        {etat === 'demarrage' && <p className="bulle__note">Chargement…</p>}
        {introuvable && <p className="bulle__note">Cette bulle n'existe plus.</p>}
        {pasSure && (
          <p className="bulle__note bulle__note--fermee" role="alert">
            {PAS_SURE}
          </p>
        )}
        {bulle && saine && <LaDemande bulle={bulle} />}
        {client && saine && <EnregistrerClient client={client} roomId={roomId} />}
        {bulle && saine && (
          <p className="bulle__rappel">Chaque message s'efface 1 minute après lecture.</p>
        )}
        {client && saine && messages.length > 0 && (
          <ol className="bulle__messages" aria-label="Messages">
            {messages.map((m) => (
              <BulleMessage
                key={m.cle}
                c={client}
                roomId={roomId}
                message={m}
                onReessayer={reessayer}
              />
            ))}
          </ol>
        )}
        {attente && saine && <p className="bulle__note">En attente de l'autre…</p>}
        {fermee && (
          <p className="bulle__note bulle__note--fermee" role="status">
            La bulle est fermée.
          </p>
        )}
        <div ref={fin} />
      </div>

      <form className="bulle__saisie" onSubmit={envoyer}>
        {bandeau && <Bandeau message={bandeau} />}
        <div className="bulle__rangee">
          <input
            className="bulle__champ"
            aria-label="Écris un message"
            placeholder="Écris un message"
            maxLength={LONGUEUR_MAX_MESSAGE}
            autoComplete="off"
            enterKeyHint="send"
            value={texte}
            disabled={!peutEcrire}
            onChange={(e) => ecrire(e.target.value)}
            onKeyDown={toucheChamp}
          />
          <button
            type="submit"
            className="bulle__envoyer"
            aria-label="Envoyer"
            disabled={!peutEcrire}
          >
            <IconeEnvoyer />
          </button>
        </div>
      </form>

      {appareil && (
        <FeuilleConfirmation
          titre="Nouvel appareil"
          texte="L'autre personne utilise un nouvel appareil. Continue seulement si tu lui fais confiance."
          confirmer="Continuer"
          chargement={acceptation}
          erreur={appareil.erreur}
          onConfirmer={() => void continuerAppareil()}
          onAnnuler={() => setAppareil(null)}
        />
      )}

      {confirmation && (
        <FeuilleConfirmation
          titre="Silence Radio ?"
          texte="Tous les messages s'effacent et la bulle se ferme pour vous deux."
          confirmer="Tout effacer"
          chargement={effacement}
          erreur={erreurSilence}
          onConfirmer={() => void faireSilence()}
          onAnnuler={() => {
            setConfirmation(false);
            setErreurSilence(null);
          }}
        />
      )}
    </main>
  );
}
