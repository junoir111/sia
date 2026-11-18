import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CHEMINS } from './chemins';
import { FournisseurMatrix, useMatrix } from './coquille/FournisseurMatrix';
import { Garde } from './coquille/Garde';
import { Accueil } from './ecrans/accueil/Accueil';
import { Bandeau } from './ecrans/bandeau/Bandeau';
import { Bientot } from './ecrans/bientot/Bientot';
import { Bulle } from './ecrans/bulle/Bulle';
import { Bulles } from './ecrans/bulles/Bulles';
import { Connexion } from './ecrans/connexion/Connexion';
import { FicheDemande } from './ecrans/fiche-demande/FicheDemande';
import { FichePrestataire } from './ecrans/fiche-prestataire/FichePrestataire';
import { Inscription } from './ecrans/inscription/Inscription';
import { ListeMetier } from './ecrans/liste-metier/ListeMetier';
import { Mur } from './ecrans/mur/Mur';
import { ProfilClient } from './ecrans/profil-client/ProfilClient';
import { ProfilPrestataire } from './ecrans/profil-prestataire/ProfilPrestataire';

/** Liste des écrans de SIA (sans le routeur, pour pouvoir la tester). */
export function RoutesSia() {
  return (
    <Routes>
      <Route path={CHEMINS.accueil} element={<Accueil />} />
      <Route path={CHEMINS.inscription} element={<Inscription />} />
      <Route path={CHEMINS.connexion} element={<Connexion />} />
      <Route path={CHEMINS.codeSecret} element={<Bientot />} />
      <Route path={CHEMINS.role} element={<Bientot />} />
      <Route
        path={CHEMINS.profilPrestataire}
        element={
          <Garde>
            <ProfilPrestataire />
          </Garde>
        }
      />
      <Route
        path={CHEMINS.profilClient}
        element={
          <Garde>
            <ProfilClient />
          </Garde>
        }
      />
      <Route
        path={CHEMINS.bulles}
        element={
          <Garde>
            <Bulles />
          </Garde>
        }
      />
      <Route
        path={CHEMINS.bulle}
        element={
          <Garde>
            <Bulle />
          </Garde>
        }
      />
      <Route
        path={CHEMINS.mur}
        element={
          <Garde>
            <Mur />
          </Garde>
        }
      />
      <Route
        path={CHEMINS.listeMetier}
        element={
          <Garde>
            <ListeMetier />
          </Garde>
        }
      />
      <Route
        path={CHEMINS.fichePrestataire}
        element={
          <Garde>
            <FichePrestataire />
          </Garde>
        }
      />
      <Route
        path={CHEMINS.ficheDemande}
        element={
          <Garde>
            <FicheDemande />
          </Garde>
        }
      />
      <Route path="*" element={<Navigate to={CHEMINS.accueil} replace />} />
    </Routes>
  );
}

/** Bandeaux M1/M2 au-dessus de tous les écrans, seulement quand le client Matrix est prêt. */
function BandeauSiPret() {
  const { etat } = useMatrix();
  return etat === 'pret' ? <Bandeau /> : null;
}

/** Coquille (client Matrix partagé + bandeau) et écrans, sans le routeur (pour les tests). */
export function AppSia() {
  return (
    <FournisseurMatrix>
      <BandeauSiPret />
      <RoutesSia />
    </FournisseurMatrix>
  );
}

export function Navigation() {
  return (
    <HashRouter>
      <AppSia />
    </HashRouter>
  );
}
