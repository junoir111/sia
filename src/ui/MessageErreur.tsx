import { IconeAlerte } from './icones';

/** Message rouge avec icône. Une phrase par ligne, comme sur la maquette. */
export function MessageErreur({ id, message }: { id?: string; message: string }) {
  const phrases = message.split(/(?<=\.)\s+/);
  return (
    <p id={id} className="message-erreur">
      <IconeAlerte className="message-erreur__icone" />
      <span>
        {phrases.map((phrase) => (
          <span key={phrase} className="message-erreur__ligne">
            {phrase}
          </span>
        ))}
      </span>
    </p>
  );
}
