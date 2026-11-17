import { HashRouter, Route, Routes } from 'react-router-dom';
import { Accueil } from './ecrans/accueil/Accueil';

/** Liste des écrans de SIA. Provisoire : un seul écran pour le socle. */
export function Navigation() {
  return (
    <HashRouter>
      <Routes>
        <Route path="*" element={<Accueil />} />
      </Routes>
    </HashRouter>
  );
}
