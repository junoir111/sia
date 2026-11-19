import { IconeCoche } from './icones';

type Proprietes = {
  /** La question posée (« D'accord ? »). */
  question: string;
  /** La réponse part : on montre « Réponse envoyée… » à la place des boutons, sans attendre le serveur. */
  envoi: boolean;
  /** Le serveur a refusé : ce message remplace la question, les boutons reviennent. */
  erreur: string | null;
  onOui: () => void;
  onNon: () => void;
  className?: string;
};

/**
 * Question + « Non » / « Oui » (bandeaux, offres de la liste des bulles). Dès qu'on touche, la ligne change
 * d'état sans bouger de hauteur : la réponse est partie, le serveur confirmera ensuite.
 */
export function ReponseOuiNon({ question, envoi, erreur, onOui, onNon, className }: Proprietes) {
  let texte = 'reponse__texte';
  if (envoi) texte += ' reponse__texte--envoi';
  else if (erreur) texte += ' reponse__texte--erreur';
  return (
    <div className={className ? `reponse ${className}` : 'reponse'}>
      <p className={texte} aria-live="polite">
        {envoi && <IconeCoche className="reponse__coche" />}
        {envoi ? 'Réponse envoyée…' : (erreur ?? question)}
      </p>
      {!envoi && (
        <>
          <button type="button" className="petit-bouton" onClick={onNon}>
            Non
          </button>
          <button type="button" className="petit-bouton petit-bouton--plein" onClick={onOui}>
            Oui
          </button>
        </>
      )}
    </div>
  );
}
