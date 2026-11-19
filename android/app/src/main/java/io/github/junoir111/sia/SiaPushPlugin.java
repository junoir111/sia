package io.github.junoir111.sia;

import android.Manifest;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * Pont entre l'appli (JavaScript) et Firebase Cloud Messaging. Méthodes : etat, activer, desactiver.
 * Événements vers le JavaScript : « jeton » ({ jeton }) et « echec ».
 * Respect de la vie privée : Firebase ne s'allume qu'à la connexion (activer) et s'éteint à la déconnexion (desactiver) ;
 * le jeton ne sert qu'à dire au serveur de SIA où envoyer un signal, qui ne contient aucun texte.
 */
@CapacitorPlugin(
        name = "SiaPush",
        permissions = {@Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = "notifications")})
public class SiaPushPlugin extends Plugin {
    private static SiaPushPlugin actif;
    private static final Handler PRINCIPAL = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        actif = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (actif == this) actif = null;
    }

    private static void signaler(String evenement, JSObject donnees) {
        PRINCIPAL.post(() -> {
            if (actif != null) actif.notifyListeners(evenement, donnees);
        });
    }

    static void signalerJeton(String jeton) {
        JSObject donnees = new JSObject();
        donnees.put("jeton", jeton);
        signaler("jeton", donnees);
    }

    static void signalerEchec() {
        signaler("echec", new JSObject());
    }

    /** Vrai si Google Play services est là et si Firebase est configuré dans cette version de l'appli. */
    private static boolean firebaseDisponible(Context contexte) {
        try {
            return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(contexte) == ConnectionResult.SUCCESS
                    && !FirebaseApp.getApps(contexte).isEmpty();
        } catch (RuntimeException indisponible) {
            return false;
        }
    }

    /** Jeton déjà reçu (ou null) et disponibilité des notifications sur ce téléphone. */
    @PluginMethod
    public void etat(PluginCall appel) {
        Context contexte = getContext();
        JSObject reponse = new JSObject();
        reponse.put("jeton", SiaPushStockage.lireJeton(contexte));
        reponse.put("disponible", firebaseDisponible(contexte));
        appel.resolve(reponse);
    }

    /** Demande l'autorisation de notifier (Android 13+), prépare le canal, allume Firebase et demande le jeton. */
    @PluginMethod
    public void activer(PluginCall appel) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", appel, "apresAutorisation");
            return;
        }
        inscrire(appel);
    }

    @PermissionCallback
    private void apresAutorisation(PluginCall appel) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            repondre(appel, "autorisation-refusee");
            return;
        }
        inscrire(appel);
    }

    private static void repondre(PluginCall appel, String statut) {
        JSObject reponse = new JSObject();
        reponse.put("statut", statut);
        appel.resolve(reponse);
    }

    private void inscrire(PluginCall appel) {
        Context contexte = getContext();
        if (!firebaseDisponible(contexte)) {
            repondre(appel, "indisponible");
            return;
        }
        SiaPushNotification.creerCanal(contexte);
        try {
            FirebaseMessaging messagerie = FirebaseMessaging.getInstance();
            messagerie.setAutoInitEnabled(true);
            messagerie.getToken().addOnCompleteListener(tache -> {
                String jeton = tache.isSuccessful() ? tache.getResult() : null;
                if (jeton == null || jeton.isEmpty()) {
                    signalerEchec();
                    repondre(appel, "indisponible");
                    return;
                }
                SiaPushStockage.ecrireJeton(contexte, jeton);
                signalerJeton(jeton);
                repondre(appel, "ok");
            });
        } catch (RuntimeException panne) {
            repondre(appel, "indisponible");
        }
    }

    /** Éteint Firebase : le jeton est supprimé chez Google, oublié ici, et la notification affichée est retirée. */
    @PluginMethod
    public void desactiver(PluginCall appel) {
        Context contexte = getContext();
        try {
            FirebaseMessaging messagerie = FirebaseMessaging.getInstance();
            messagerie.deleteToken();
            messagerie.setAutoInitEnabled(false);
        } catch (RuntimeException sansEffet) {
            // Firebase absent ou déjà éteint : on efface quand même ce qui est local.
        }
        SiaPushStockage.effacerJeton(contexte);
        SiaPushNotification.retirerTout(contexte);
        appel.resolve();
    }
}
