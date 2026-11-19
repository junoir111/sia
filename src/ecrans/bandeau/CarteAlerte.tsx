import { useLayoutEffect, useRef } from 'react';
import { ReponseOuiNon } from '../../ui/ReponseOuiNon';
import { messageEchec, reponseParties, useReponse } from './reponses';

const TAILLE_LIGNE = 15;
const TAILLE_LIGNE_MIN = 13;

/** Ce qu'une carte d'alerte montre. */
export type VueAlerte = {
  /** Identifiant stable de l'alerte (la demande ou la bulle). */
  cle: string;
  /** Nom lu par le lecteur d'écran. */
  nom: string;
  ligne: string;
  question: string;
};

/** Réduit un peu la taille du texte (jusqu'à 13 px) pour qu'il tienne sur une ligne, comme la maquette. */
function useTexteAjuste(texte: string) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const p = ref.current;
    if (!p) return;
    let taille = TAILLE_LIGNE;
    p.style.fontSize = `${taille}px`;
    while (p.scrollWidth > p.clientWidth && taille > TAILLE_LIGNE_MIN) {
      taille -= 0.5;
      p.style.fontSize = `${taille}px`;
    }
  }, [texte]);
  return ref;
}

type Proprietes = {
  vue: VueAlerte;
  onRepondre: (oui: boolean) => void;
};

/**
 * Une carte du bandeau (M1 / M2). Au toucher elle change d'état tout de suite (« Réponse envoyée… »),
 * sans attendre le serveur ; elle s'en va quand le serveur confirme, ou revient avec un message s'il refuse.
 */
export function CarteAlerte({ vue, onRepondre }: Proprietes) {
  const reponse = useReponse(vue.cle);
  const ligne = useTexteAjuste(vue.ligne);
  return (
    <section className="notif__carte" aria-label={vue.nom} data-glisse={vue.cle}>
      <p className="notif__ligne" ref={ligne}>
        {vue.ligne}
      </p>
      <ReponseOuiNon
        question={vue.question}
        envoi={reponseParties(reponse)}
        erreur={messageEchec(reponse)}
        onOui={() => onRepondre(true)}
        onNon={() => onRepondre(false)}
      />
    </section>
  );
}
