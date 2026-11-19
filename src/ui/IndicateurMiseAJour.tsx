/**
 * « Mise à jour… » discret, en haut d'une liste vivante, pendant que le client rattrape ses événements.
 * La zone existe toujours (même vide) : rien ne bouge quand le texte arrive, et le lecteur d'écran l'annonce.
 * Le texte n'apparaît qu'après un court délai : une mise à jour rapide ne fait aucun clignotement.
 */
export function IndicateurMiseAJour({ actif }: { actif: boolean }) {
  return (
    <span className="maj" aria-live="polite">
      {actif && <span className="maj__texte">Mise à jour…</span>}
    </span>
  );
}
