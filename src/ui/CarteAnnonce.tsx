import { Link } from 'react-router-dom';

type Proprietes = {
  pseudo: string;
  quand: string;
  /** « Akanda · 5 000 FCFA · Plombier » */
  resume: string;
  texte?: string;
  /** Montre la gélule « D'accord ? » (simple repère : toute la carte ouvre la fiche). */
  avecAction?: boolean;
  to: string;
};

/** Demande d'un client : qui, quand, quartier · budget · métier, et un repère d'action. */
export function CarteAnnonce({ pseudo, quand, resume, texte, avecAction, to }: Proprietes) {
  return (
    <Link className="carte-annonce" to={to}>
      <span className="carte-annonce__haut">
        <span className="carte-annonce__pseudo">{pseudo}</span>
        <span className="carte-annonce__quand">{quand}</span>
      </span>
      <span className="carte-annonce__resume">{resume}</span>
      {texte && <span className="carte-annonce__texte">{texte}</span>}
      {avecAction && (
        <span className="carte-annonce__bas" aria-hidden="true">
          <span className="carte-annonce__puce">D'accord ?</span>
        </span>
      )}
    </Link>
  );
}
