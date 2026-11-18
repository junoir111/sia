package io.github.junoir111.sia;

import android.content.Context;
import org.unifiedpush.android.connector.FailedReason;
import org.unifiedpush.android.connector.PushService;
import org.unifiedpush.android.connector.data.PushEndpoint;
import org.unifiedpush.android.connector.data.PushMessage;

/** Reçoit les événements du distributeur UnifiedPush (ntfy). Ne lit JAMAIS le contenu d'un signal. */
public class SiaPushService extends PushService {
    @Override
    public void onMessage(PushMessage message, String instance) {
        // Volontairement : `message` n'est pas lu. Un signal = une notification neutre.
        SiaPushNotification.afficher(this);
    }

    @Override
    public void onNewEndpoint(PushEndpoint endpoint, String instance) {
        Context contexte = getApplicationContext();
        SiaPushStockage.ecrireEndpoint(contexte, endpoint.getUrl());
        SiaPushPlugin.signalerEndpoint(endpoint.getUrl());
    }

    @Override
    public void onRegistrationFailed(FailedReason raison, String instance) {
        SiaPushPlugin.signalerEchec();
    }

    @Override
    public void onUnregistered(String instance) {
        SiaPushStockage.effacerEndpoint(getApplicationContext());
        SiaPushPlugin.signalerDesinscription();
    }
}
