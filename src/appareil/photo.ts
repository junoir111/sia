/*
 * Photo du profil : elle reste sur le téléphone (IndexedDB, base « sia », magasin « photos »,
 * clé « profil ») et ne part jamais vers le serveur en clair (document 5, table PROFIL).
 * Elle est réduite et réencodée en JPEG : cela retire aussi les informations cachées
 * de la photo d'origine (position GPS, modèle du téléphone...).
 */

const NOM_BASE = 'sia';
const VERSION_BASE = 1;
const MAGASIN = 'photos';
const CLE_PHOTO = 'profil';

const COTE_MAX_PX = 1024;
const QUALITE_JPEG = 0.7;
/** Fichier d'origine refusé au-delà de cette taille (évite de bloquer le téléphone). */
const TAILLE_MAX_FICHIER = 25 * 1024 * 1024;

export async function preparerPhoto(fichier: File): Promise<Blob> {
  if (!(fichier instanceof Blob) || !fichier.type.startsWith('image/')) {
    throw new Error('Ce fichier n’est pas une image.');
  }
  if (fichier.size === 0 || fichier.size > TAILLE_MAX_FICHIER) {
    throw new Error('Cette image est vide ou trop lourde (25 Mo au plus).');
  }
  let image: ImageBitmap;
  try {
    // `from-image` applique l'orientation EXIF avant de redessiner (sinon une photo prise de côté reste tournée).
    image = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Cette image est illisible.');
  }
  try {
    if (image.width === 0 || image.height === 0) throw new Error('Cette image est illisible.');
    const echelle = Math.min(1, COTE_MAX_PX / Math.max(image.width, image.height));
    const toile = document.createElement('canvas');
    toile.width = Math.max(1, Math.round(image.width * echelle));
    toile.height = Math.max(1, Math.round(image.height * echelle));
    const contexte = toile.getContext('2d');
    if (!contexte) throw new Error('Impossible de préparer la photo sur cet appareil.');
    contexte.drawImage(image, 0, 0, toile.width, toile.height);
    return await new Promise<Blob>((resoudre, rejeter) => {
      toile.toBlob(
        (resultat) =>
          resultat
            ? resoudre(resultat)
            : rejeter(new Error('Impossible de préparer la photo sur cet appareil.')),
        'image/jpeg',
        QUALITE_JPEG,
      );
    });
  } finally {
    image.close();
  }
}

function ouvrirBase(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const demande = indexedDB.open(NOM_BASE, VERSION_BASE);
    demande.onupgradeneeded = () => {
      if (!demande.result.objectStoreNames.contains(MAGASIN)) {
        demande.result.createObjectStore(MAGASIN);
      }
    };
    demande.onsuccess = () => resoudre(demande.result);
    demande.onerror = () => rejeter(new Error('Stockage du téléphone indisponible.'));
  });
}

async function operation<T>(
  mode: IDBTransactionMode,
  action: (magasin: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const base = await ouvrirBase();
  try {
    return await new Promise<T>((resoudre, rejeter) => {
      const transaction = base.transaction(MAGASIN, mode);
      const demande = action(transaction.objectStore(MAGASIN));
      transaction.oncomplete = () => resoudre(demande.result as T);
      transaction.onerror = () => rejeter(new Error('Stockage du téléphone indisponible.'));
      transaction.onabort = () => rejeter(new Error('Stockage du téléphone indisponible.'));
    });
  } finally {
    base.close();
  }
}

export async function enregistrerPhoto(photo: Blob): Promise<void> {
  if (!(photo instanceof Blob) || !photo.type.startsWith('image/')) {
    throw new Error('Ce fichier n’est pas une image.');
  }
  await operation<unknown>('readwrite', (magasin) => magasin.put(photo, CLE_PHOTO));
}

/** Photo enregistrée, ou null si absente ou si la valeur gardée n'est pas une image. */
export async function lirePhoto(): Promise<Blob | null> {
  const valeur = await operation<unknown>('readonly', (magasin) => magasin.get(CLE_PHOTO));
  return valeur instanceof Blob && valeur.type.startsWith('image/') ? valeur : null;
}

export async function effacerPhoto(): Promise<void> {
  await operation<unknown>('readwrite', (magasin) => magasin.delete(CLE_PHOTO));
}
