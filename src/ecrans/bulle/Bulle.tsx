import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
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
  signalerEcriture,
  silenceRadio,
} from '../../matrix/bulles';
import type { ResumeBulle } from '../../matrix/bulles';
import { marquerAffiche } from '../../matrix/ephemere';
import { Bandeau } from '../../ui/Bandeau';
import { FeuilleConfirmation } from '../../ui/FeuilleConfirmation';
import { RondInitiale } from '../../ui/RondInitiale';
import { IconeChevron, IconeEnvoyer, IconeRetour } from '../../ui/icones';
import { familleErreur } from '../profil-client/branchements';
import { useBulles } from '../bulles/useBulles';
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

function messageErreur(e: unknown): string {
  return familleErreur(e) === 'reseau' ? PAS_DE_RESEAU : PROBLEME;
}

/** « 7 000 » ne se coupe pas en fin de ligne (espace insécable entre les milliers). */
function garderMontants(texte: string): string {
  return texte.replace(/(\d) (?=\d{3}\b)/g, '$1\u00a0');
}

/** Un message ; la fine barre se vide jusqu'à son effacement (1 minute après affichage). */
function BulleMessage({
  c,
  roomId,
  message,
}: {
  c: MatrixClient;
  roomId: string;
  message: Message;
}) {
  const [reste] = useState(() => tempsRestant(message.id, Date.now()));
  useEffect(() => {
    if (!message.moi) marquerAffiche(c, roomId, message.id);
  }, [c, roomId, message]);

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
  const [envoi, setEnvoi] = useState(false);
  const [bandeau, setBandeau] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [effacement, setEffacement] = useState(false);
  const [erreurSilence, setErreurSilence] = useState<string | null>(null);
  const [appareil, setAppareil] = useState<{ corps: string; erreur: string | null } | null>(null);
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
  }

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    const corps = texte.trim();
    if (!client || !peutEcrire || envoi || corps === '') return;
    setEnvoi(true);
    setBandeau(null);
    try {
      await envoyerMessage(client, roomId, corps);
      setTexte('');
      dernierSignal.current = 0;
      void signalerEcriture(client, roomId, false).catch(() => undefined);
    } catch (erreur) {
      if (estNouvelAppareil(erreur)) setAppareil({ corps, erreur: null });
      else setBandeau(messageErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  /** L'autre a un nouvel appareil : l'utilisateur lui fait confiance, on accepte puis on renvoie. */
  async function continuerAppareil() {
    if (!client || !appareil || acceptation) return;
    setAcceptation(true);
    try {
      await accepterNouvelAppareil(client, roomId);
      await envoyerMessage(client, roomId, appareil.corps);
      setAppareil(null);
      setTexte('');
      dernierSignal.current = 0;
      void signalerEcriture(client, roomId, false).catch(() => undefined);
    } catch (erreur) {
      setAppareil({ corps: appareil.corps, erreur: messageErreur(erreur) });
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
        {bulle && saine && (
          <p className="bulle__rappel">Chaque message s'efface 1 minute après lecture.</p>
        )}
        {client && saine && messages.length > 0 && (
          <ol className="bulle__messages" aria-label="Messages">
            {messages.map((m) => (
              <BulleMessage key={m.id} c={client} roomId={roomId} message={m} />
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
            value={texte}
            disabled={!peutEcrire}
            onChange={(e) => ecrire(e.target.value)}
          />
          <button
            type="submit"
            className="bulle__envoyer"
            aria-label="Envoyer"
            disabled={!peutEcrire || envoi}
            aria-busy={envoi || undefined}
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
