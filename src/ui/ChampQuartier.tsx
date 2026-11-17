import { useId, useState } from 'react';
import { chercherQuartiers } from '../logique/quartiers';
import { IconeLoupe } from './icones';
import { MessageErreur } from './MessageErreur';

const NB_SUGGESTIONS = 4;

type Proprietes = {
  valeur: string;
  onChange: (valeur: string) => void;
  erreur?: string;
  maxLength?: number;
};

// Même simplification que la recherche : sans accents, minuscules, lettres et chiffres seuls.
function simplifierLettre(lettre: string): string {
  return lettre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Coupe un nom en [avant, lettres tapées, après] pour mettre les lettres tapées en gras. */
export function decouperSuggestion(nom: string, saisie: string): [string, string, string] {
  const cle = [...saisie].map(simplifierLettre).join('');
  let simple = '';
  const origine: number[] = [];
  [...nom].forEach((lettre, i) => {
    for (const c of simplifierLettre(lettre)) {
      simple += c;
      origine.push(i);
    }
  });
  const debut = cle === '' ? -1 : simple.indexOf(cle);
  const premier = origine[debut];
  const dernier = origine[debut + cle.length - 1];
  if (debut < 0 || premier === undefined || dernier === undefined) return ['', '', nom];
  const lettres = [...nom];
  return [
    lettres.slice(0, premier).join(''),
    lettres.slice(premier, dernier + 1).join(''),
    lettres.slice(dernier + 1).join(''),
  ];
}

/** Champ quartier avec loupe ; propose les quartiers connus pendant la frappe (texte libre permis). */
export function ChampQuartier({ valeur, onChange, erreur, maxLength }: Proprietes) {
  const id = useId();
  const idListe = `${id}-liste`;
  const idErreur = `${id}-erreur`;
  const [ouverte, setOuverte] = useState(false);
  const suggestions = ouverte ? chercherQuartiers(valeur, NB_SUGGESTIONS) : [];
  const exacte = suggestions.length === 1 && suggestions[0] === valeur;
  const visibles = exacte ? [] : suggestions;

  function choisir(nom: string) {
    onChange(nom);
    setOuverte(false);
  }

  return (
    <div className="quartier">
      <div className="quartier__cadre">
        <IconeLoupe className="quartier__loupe" />
        <input
          className="champ__saisie quartier__saisie"
          role="combobox"
          aria-label="Quartier"
          aria-autocomplete="list"
          aria-expanded={visibles.length > 0}
          aria-controls={idListe}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? idErreur : undefined}
          placeholder="Quartier"
          autoComplete="off"
          maxLength={maxLength}
          value={valeur}
          onChange={(e) => {
            onChange(e.target.value);
            setOuverte(true);
          }}
          onBlur={() => setOuverte(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOuverte(false);
          }}
        />
      </div>
      <ul
        id={idListe}
        role="listbox"
        aria-label="Quartiers proposés"
        className="quartier__liste"
        hidden={visibles.length === 0}
        // Garde le clavier ouvert : le choix se fait au toucher, sans quitter le champ.
        onMouseDown={(e) => e.preventDefault()}
      >
        {visibles.map((nom) => {
          const [avant, gras, apres] = decouperSuggestion(nom, valeur);
          return (
            <li
              key={nom}
              role="option"
              aria-selected={false}
              className="quartier__option"
              onClick={() => choisir(nom)}
            >
              {/* Un seul bloc de texte : le nom reste lu d'un trait (« Akanda », pas « Ak anda »). */}
              <span>
                {avant}
                <strong>{gras}</strong>
                {apres}
              </span>
            </li>
          );
        })}
      </ul>
      {erreur && <MessageErreur id={idErreur} message={erreur} />}
    </div>
  );
}
