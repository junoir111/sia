import { formaterPrix, lirePrix } from '../logique/profil';

type Proprietes = {
  numero: number;
  nom: string;
  prix: string;
  onNom: (valeur: string) => void;
  onPrix: (valeur: string) => void;
  invalide?: boolean;
  idErreur?: string;
  maxNom?: number;
};

/** Une ligne de service : nom à gauche, prix en FCFA à droite (affiché « 5 000 » en quittant le champ). */
export function LigneService({
  numero,
  nom,
  prix,
  onNom,
  onPrix,
  invalide,
  idErreur,
  maxNom,
}: Proprietes) {
  const aria = {
    'aria-invalid': invalide || undefined,
    'aria-describedby': invalide ? idErreur : undefined,
  };
  function arrondir() {
    const lu = lirePrix(prix);
    if (lu !== null && formaterPrix(lu) !== prix) onPrix(formaterPrix(lu));
  }
  return (
    <div className="service">
      <input
        className="champ__saisie service__nom"
        aria-label={`Service ${numero}`}
        placeholder="Nom du service"
        value={nom}
        maxLength={maxNom}
        onChange={(e) => onNom(e.target.value)}
        {...aria}
      />
      <div className="service__prix">
        <input
          className="champ__saisie service__saisie-prix"
          aria-label={`Prix du service ${numero}, en FCFA`}
          placeholder="Prix"
          inputMode="numeric"
          autoComplete="off"
          value={prix}
          onChange={(e) => onPrix(e.target.value)}
          onBlur={arrondir}
          {...aria}
        />
        <span className="service__devise" aria-hidden="true">
          FCFA
        </span>
      </div>
    </div>
  );
}
