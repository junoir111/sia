package io.github.junoir111.sia;

import android.content.Context;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Reçoit les événements de Firebase Cloud Messaging. Ne lit JAMAIS le contenu d'un signal : la passerelle du serveur n'y met
 * d'ailleurs aucun texte (PRD F12 : jamais de texte de message).
 */
public class SiaPushService extends FirebaseMessagingService {
    /** Google a donné un nouveau jeton (réinstallation, effacement des données...) : on le garde et on prévient l'appli. */
    @Override
    public void onNewToken(String jeton) {
        Context contexte = getApplicationContext();
        SiaPushStockage.ecrireJeton(contexte, jeton);
        SiaPushPlugin.signalerJeton(jeton);
    }

    /**
     * Appli ouverte : les cartes de l'appli s'en chargent, rien à afficher ici. Appli en arrière-plan : Google Play services
     * affiche tout seul la notification neutre envoyée par la passerelle. Seul un signal « de données » (sans notification)
     * passe par ici pour afficher la même notification neutre.
     */
    @Override
    public void onMessageReceived(RemoteMessage message) {
        if (message.getNotification() == null) {
            SiaPushNotification.afficher(this);
        }
    }
}
