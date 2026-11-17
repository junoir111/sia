# SIA

Messagerie chiffrée de bout en bout pour un petit cercle d'amis, construite sur le protocole Matrix.
Appli React + TypeScript (Vite), transformée plus tard en appli Android avec Capacitor.

## Commandes

```bash
npm ci            # installe les bibliothèques (versions exactes de package-lock.json)
npm run dev       # aperçu dans le navigateur : http://127.0.0.1:5173
npm run verifier  # types + ESLint + tests : doit passer avant chaque envoi
npm test          # tests en continu
npm run build     # fabrique la version finale dans dist/
```

## Règles

- Aucune bibliothèque qui n'est pas écrite dans le document technique (TRD).
- Aucun service extérieur : pas de statistiques, pas de rapport d'erreur, pas de police en ligne.
- Aucun secret dans le code. La clé de signature ne quitte jamais le PC de fabrication.

## Licence

GNU AGPL-3.0 : voir [LICENSE](LICENSE).
