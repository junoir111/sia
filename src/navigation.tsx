import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CHEMINS } from './chemins';
import { Accueil } from './ecrans/accueil/Accueil';
import { Bientot } from './ecrans/bientot/Bientot';
import { Inscription } from './ecrans/inscription/Inscription';
import { ProfilPrestataire } from './ecrans/profil-prestataire/ProfilPrestataire';

/** Liste des écrans de SIA (sans le routeur, pour pouvoir la tester). */
export function RoutesSia() {
  return (
    <Routes>
      <Route path={CHEMINS.accueil} element={<Accueil />} />
      <Route path={CHEMINS.inscription} element={<Inscription />} />
      <Route path={CHEMINS.connexion} element={<Bientot />} />
      <Route path={CHEMINS.codeSecret} element={<Bientot />} />
      <Route path={CHEMINS.role} element={<Bientot />} />
      <Route path={CHEMINS.profilPrestataire} element={<ProfilPrestataire />} />
      <Route path={CHEMINS.profilClient} element={<Bientot />} />
      <Route path={CHEMINS.mur} element={<Bientot />} />
      <Route path="*" element={<Navigate to={CHEMINS.accueil} replace />} />
    </Routes>
  );
}

export function Navigation() {
  return (
    <HashRouter>
      <RoutesSia />
    </HashRouter>
  );
}
