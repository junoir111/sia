/*
 * Chiffrement d'une image envoyée dans une bulle (format Matrix « EncryptedFile v2 »).
 * On chiffre l'image NOUS-MÊMES avec WebCrypto (AES-CTR 256 bits) avant de l'envoyer au serveur : le serveur
 * ne garde qu'un paquet d'octets illisibles. La clé voyage DANS l'événement chiffré de bout en bout (Megolm),
 * jamais vers le serveur en clair. Quand l'événement est effacé (minute écoulée ou robot), la clé disparaît et
 * le paquet gardé par le serveur devient à jamais indéchiffrable.
 *
 * Aucune dépendance ajoutée : le SDK n'expose pas ce chiffrement, on suit la spec Matrix à la main.
 */

/** Référence d'un fichier chiffré, telle qu'elle voyage dans le contenu de l'événement (champ `file`). */
export type FichierChiffre = {
  v: 'v2';
  url: string;
  key: JsonWebKey;
  iv: string;
  hashes: { sha256: string };
  mimetype?: string;
};

const ALGO = 'AES-CTR';
const BITS_CLE = 256;
// AES-CTR : le compteur de 16 octets = 8 octets au hasard (nonce) + 8 octets à zéro (le compteur lui-même,
// sur 64 bits, ne débordera jamais pour une image de quelques Mo).
const OCTETS_IV = 16;
const BITS_COMPTEUR = 64;

function enBase64(octets: Uint8Array): string {
  let binaire = '';
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/=+$/, '');
}

function depuisBase64(texte: string): Uint8Array {
  const binaire = atob(texte.replace(/-/g, '+').replace(/_/g, '/'));
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
}

async function sha256(octets: Uint8Array): Promise<string> {
  const empreinte = await crypto.subtle.digest('SHA-256', octets as BufferSource);
  return enBase64(new Uint8Array(empreinte));
}

/** Comparaison d'empreintes qui ne s'arrête pas au premier signe différent. */
function memeTexte(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

/**
 * Chiffre une image. Rend les octets chiffrés (à envoyer au serveur) et la référence `file` (clé comprise,
 * à mettre dans l'événement chiffré). L'`url` reste à remplir après l'envoi au serveur.
 */
export async function chiffrerImage(
  image: Blob,
): Promise<{ chiffre: Uint8Array; file: Omit<FichierChiffre, 'url'> }> {
  const clair = new Uint8Array(await image.arrayBuffer());
  const cle = await crypto.subtle.generateKey({ name: ALGO, length: BITS_CLE }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = new Uint8Array(OCTETS_IV);
  crypto.getRandomValues(iv.subarray(0, 8)); // 8 octets au hasard, 8 à zéro
  const chiffreBuffer = await crypto.subtle.encrypt(
    { name: ALGO, counter: iv as BufferSource, length: BITS_COMPTEUR },
    cle,
    clair as BufferSource,
  );
  const chiffre = new Uint8Array(chiffreBuffer);
  const jwk = await crypto.subtle.exportKey('jwk', cle);
  return {
    chiffre,
    file: {
      v: 'v2',
      key: { ...jwk, key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', ext: true },
      iv: enBase64(iv),
      hashes: { sha256: await sha256(chiffre) },
      mimetype: image.type || 'image/jpeg',
    },
  };
}

/**
 * Déchiffre des octets reçus, après avoir vérifié leur empreinte (une image modifiée en route est refusée).
 * Rend un Blob affichable, ou null si quoi que ce soit cloche (empreinte, clé, format).
 */
export async function dechiffrerImage(
  file: FichierChiffre,
  chiffre: Uint8Array,
): Promise<Blob | null> {
  try {
    if (file.v !== 'v2' || file.key.alg !== 'A256CTR') return null;
    if (!memeTexte(await sha256(chiffre), file.hashes.sha256)) return null;
    const cle = await crypto.subtle.importKey('jwk', file.key, { name: ALGO }, false, ['decrypt']);
    const iv = depuisBase64(file.iv);
    if (iv.length !== OCTETS_IV) return null;
    const clair = await crypto.subtle.decrypt(
      { name: ALGO, counter: iv as BufferSource, length: BITS_COMPTEUR },
      cle,
      chiffre as BufferSource,
    );
    const type = typeof file.mimetype === 'string' ? file.mimetype : 'image/jpeg';
    return new Blob([clair], { type: type.startsWith('image/') ? type : 'image/jpeg' });
  } catch {
    return null;
  }
}

/** Vrai si `valeur` a la forme d'un fichier chiffré v2 (vérifié avant de s'en servir). */
export function estFichierChiffre(valeur: unknown): valeur is FichierChiffre {
  if (typeof valeur !== 'object' || valeur === null) return false;
  const f = valeur as Record<string, unknown>;
  if (f.v !== 'v2' || typeof f.url !== 'string') return false;
  if (typeof f.iv !== 'string' || typeof f.key !== 'object' || f.key === null) return false;
  const hashes = f.hashes as Record<string, unknown> | null;
  return (
    typeof hashes === 'object' && hashes !== null && typeof hashes.sha256 === 'string'
  );
}
