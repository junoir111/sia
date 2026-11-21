import { useEffect, useRef, useState } from 'react';
import { attenteAvantEssai, definirCode, verifierCode } from '../../appareil/verrou';
import { LONGUEUR_CODE } from '../../logique/code-secret';
import { ClavierCode } from './ClavierCode';
import { SortieDuCode } from './SortieDuCode';
import './code.css';

type Mode = 'taper' | 'choisir';

/** Un code faux reste affiché (en rouge) un instant avant que les ronds se vident. */
const DELAI_FAUX_MS = 400;
/** Le décompte de l'attente se rafraîchit à ce rythme. */
const PAS_DECOMPTE_MS = 250;

type Attente = { fin: number; maintenant: number };

function attendre(ms: number): Attente {
  const maintenant = Date.now();
  return { fin: maintenant + ms, maintenant };
}

function texteEssais(restants: number): string {
  return restants === 1
    ? 'Code faux. Il te reste 1 essai.'
    : `Code faux. Il te reste ${restants} essais.`;
}

function textesDe(mode: Mode, confirmation: boolean): { titre: string; aide: string } {
  if (mode === 'taper') return { titre: 'Entre ton code', aide: 'Pour ouvrir SIA.' };
  if (confirmation) return { titre: 'Confirme ton code', aide: 'Tape-le encore une fois.' };
  return {
    titre: 'Choisis ton code secret',
    aide: '4 chiffres. Il verrouille SIA à chaque ouverture et reste sur ce téléphone. Retiens-le bien.',
  };
}

function resumeRonds(n: number): string {
  return `${n} ${n > 1 ? 'chiffres' : 'chiffre'} sur ${LONGUEUR_CODE}`;
}

/**
 * Écran du code secret (F12). `taper` : l'appli est fermée à clé, il faut le bon code. `choisir` : ce téléphone
 * n'a pas encore de code, on en choisit un (tapé deux fois). Le code est vérifié dès le 4e chiffre.
 */
export function EcranCode({ mode }: { mode: Mode }) {
  const [affiche, setAffiche] = useState('');
  const [premier, setPremier] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [faux, setFaux] = useState(false);
  const [attente, setAttente] = useState<Attente>(() => attendre(attenteAvantEssai()));
  const [sortie, setSortie] = useState(false);
  // Les chiffres tapés vivent aussi ici : deux appuis dans le même instant ne doivent pas se marcher dessus.
  const chiffres = useRef('');
  const occupe = useRef(false);
  const delaiFaux = useRef<number | undefined>(undefined);

  const secondes = Math.max(0, Math.ceil((attente.fin - attente.maintenant) / 1000));
  const enAttente = secondes > 0;

  // Décompte de l'attente : l'écran se rafraîchit jusqu'à la fin.
  useEffect(() => {
    if (attente.fin <= Date.now()) return;
    const id = window.setInterval(() => {
      const maintenant = Date.now();
      setAttente((a) => ({ ...a, maintenant }));
      if (maintenant >= attente.fin) window.clearInterval(id);
    }, PAS_DECOMPTE_MS);
    return () => window.clearInterval(id);
  }, [attente.fin]);

  useEffect(() => () => window.clearTimeout(delaiFaux.current), []);

  function mettre(valeur: string) {
    chiffres.current = valeur;
    setAffiche(valeur);
  }

  function refuser(texte: string | null) {
    setFaux(true);
    setErreur(texte);
    window.clearTimeout(delaiFaux.current);
    delaiFaux.current = window.setTimeout(() => {
      mettre('');
      setFaux(false);
      occupe.current = false;
    }, DELAI_FAUX_MS);
  }

  async function taper(code: string) {
    try {
      const resultat = await verifierCode(code);
      if (resultat.etat === 'ok') return; // la porte s'ouvre : cet écran disparaît
      if (resultat.etat === 'attente') {
        setAttente(attendre(resultat.ms));
        refuser(null);
      } else {
        refuser(texteEssais(resultat.restants));
      }
    } catch {
      refuser('Le code n’a pas pu être vérifié. Réessaie.');
    }
  }

  async function choisir(code: string) {
    if (premier === null) {
      setPremier(code);
      mettre('');
      occupe.current = false;
      return;
    }
    if (code !== premier) {
      setPremier(null);
      refuser('Les deux codes ne sont pas pareils. Recommence.');
      return;
    }
    try {
      await definirCode(code); // la porte s'ouvre : cet écran disparaît
    } catch {
      refuser('Le téléphone n’a pas pu garder le code. Réessaie.');
    }
  }

  function ajouter(chiffre: string) {
    if (occupe.current || enAttente || sortie) return;
    if (chiffres.current.length >= LONGUEUR_CODE) return;
    setFaux(false);
    setErreur(null);
    const valeur = chiffres.current + chiffre;
    mettre(valeur);
    if (valeur.length === LONGUEUR_CODE) {
      occupe.current = true;
      void (mode === 'taper' ? taper(valeur) : choisir(valeur));
    }
  }

  function effacer() {
    if (occupe.current) return;
    mettre(chiffres.current.slice(0, -1));
  }

  const { titre, aide } = textesDe(mode, premier !== null);
  const message = enAttente ? `Trop d'essais. Réessaie dans ${secondes} s.` : erreur;

  return (
    <main className="ecran code">
      <div className="code__haut">
        <p className="code__marque" aria-hidden="true">
          SIA
          <span className="code__point" />
        </p>
        <h1 className="code__titre">{titre}</h1>
        <p className="code__aide">{aide}</p>
      </div>
      <div className="code__milieu">
        <div
          className={faux ? 'code__ronds code__ronds--faux' : 'code__ronds'}
          role="img"
          aria-label={resumeRonds(affiche.length)}
        >
          {Array.from({ length: LONGUEUR_CODE }, (_, i) => (
            <span
              key={i}
              className={i < affiche.length ? 'code__rond code__rond--plein' : 'code__rond'}
            />
          ))}
        </div>
        <p className="code__message" role="alert">
          {message}
        </p>
        <ClavierCode
          desactive={enAttente || sortie}
          effacable={affiche.length > 0}
          onChiffre={ajouter}
          onEffacer={effacer}
        />
      </div>
      <SortieDuCode
        mode={mode}
        ouverte={sortie}
        onOuvrir={() => setSortie(true)}
        onFermer={() => setSortie(false)}
      />
    </main>
  );
}
