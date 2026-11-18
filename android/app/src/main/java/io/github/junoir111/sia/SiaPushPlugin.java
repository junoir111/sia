package io.github.junoir111.sia;

import android.Manifest;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;
import kotlin.Unit;
import org.unifiedpush.android.connector.ConstantsKt;
import org.unifiedpush.android.connector.UnifiedPush;

/**
 * Pont entre l'appli (JavaScript) et UnifiedPush (bibliothèque officielle org.unifiedpush.android:connector).
 * Aucun Firebase, aucun service de Google. Méthodes : etat, activer, desactiver.
 * Événements vers le JavaScript : « endpoint » ({ endpoint }), « desinscrit », « echec ».
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

    static void signalerEndpoint(String endpoint) {
        JSObject donnees = new JSObject();
        donnees.put("endpoint", endpoint);
        signaler("endpoint", donnees);
    }

    static void signalerDesinscription() {
        signaler("desinscrit", new JSObject());
    }

    static void signalerEchec() {
        signaler("echec", new JSObject());
    }

    /** Distributeurs installés, distributeur choisi, adresse de réception déjà reçue (ou null). */
    @PluginMethod
    public void etat(PluginCall appel) {
        Context contexte = getContext();
        JSObject reponse = new JSObject();
        JSArray liste = new JSArray();
        for (String nom : UnifiedPush.getDistributors(contexte)) liste.put(nom);
        reponse.put("distributeurs", liste);
        reponse.put("distributeur", UnifiedPush.getAckDistributor(contexte));
        reponse.put("endpoint", SiaPushStockage.lireEndpoint(contexte));
        appel.resolve(reponse);
    }

    /** Demande l'autorisation de notifier (Android 13+), choisit le distributeur et inscrit l'appli. */
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
        List<String> distributeurs = UnifiedPush.getDistributors(contexte);
        if (distributeurs.isEmpty()) {
            repondre(appel, "sans-distributeur");
            return;
        }
        String courant = UnifiedPush.getAckDistributor(contexte);
        if (courant != null && distributeurs.contains(courant)) {
            enregistrer(appel, contexte);
        } else if (distributeurs.size() == 1) {
            UnifiedPush.saveDistributor(contexte, distributeurs.get(0));
            enregistrer(appel, contexte);
        } else {
            // Plusieurs distributeurs : l'utilisateur choisit dans l'écran du système.
            UnifiedPush.tryUseCurrentOrDefaultDistributor(getActivity(), choisi -> {
                if (choisi) enregistrer(appel, contexte);
                else repondre(appel, "sans-distributeur");
                return Unit.INSTANCE;
            });
        }
    }

    private void enregistrer(PluginCall appel, Context contexte) {
        UnifiedPush.register(contexte, ConstantsKt.INSTANCE_DEFAULT, null, null);
        repondre(appel, "ok");
    }

    /** Désinscrit l'appli du distributeur, oublie l'adresse et retire la notification affichée. */
    @PluginMethod
    public void desactiver(PluginCall appel) {
        Context contexte = getContext();
        try {
            UnifiedPush.unregister(contexte, ConstantsKt.INSTANCE_DEFAULT);
        } catch (RuntimeException sansEffet) {
            // Distributeur déjà désinstallé : on efface quand même ce qui est local.
        }
        SiaPushStockage.effacerEndpoint(contexte);
        SiaPushNotification.retirer(contexte);
        appel.resolve();
    }
}
