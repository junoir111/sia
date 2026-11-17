import { IconeAlerte } from './icones';

/** Bandeau d'information (pas de réseau, problème) : lu tout de suite par le lecteur d'écran. */
export function Bandeau({ message }: { message: string }) {
  return (
    <p className="bandeau" role="alert">
      <IconeAlerte className="bandeau__icone" />
      <span>{message}</span>
    </p>
  );
}
