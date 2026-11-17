// F4 / F5 — Champ quartier : liste des quartiers du Grand Libreville et recherche pendant la frappe.

// Seulement des noms sûrs. Par ordre alphabétique.
export const QUARTIERS: readonly string[] = [
  'Akanda',
  'Akébé',
  'Akournam',
  'Alénakiri',
  'Alibandeng',
  'Angondjé',
  'Atong Abè',
  'Avorbam',
  'Awendjé',
  'Batterie IV',
  'Belle-Vue',
  'Charbonnages',
  'Cocotiers',
  'Glass',
  'Gué-Gué',
  'Kalikak',
  'Lalala',
  'Libreville',
  'London',
  'Louis',
  'Mont-Bouët',
  'Montagne Sainte',
  'Nkembo',
  'Ntoum',
  'Nzeng-Ayong',
  'Okala',
  'Oloumi',
  'Owendo',
  'PK5',
  'PK6',
  'PK7',
  'PK8',
  'PK9',
  'PK10',
  'PK11',
  'PK12',
  'Plaine Orety',
  'Sablière',
  'Sotega',
  'Venez-Voir',
];

// Minuscules, sans accents, sans espaces ni tirets : « Mont-Bouët » -> « montbouet ».
function simplifier(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function chercherQuartiers(saisie: string, max = 4): string[] {
  const cle = simplifier(saisie);
  if (cle === '') {
    return [];
  }
  const commencent = QUARTIERS.filter((q) => simplifier(q).startsWith(cle));
  const contiennent = QUARTIERS.filter(
    (q) => !simplifier(q).startsWith(cle) && simplifier(q).includes(cle),
  );
  return [...commencent, ...contiennent].slice(0, max);
}
