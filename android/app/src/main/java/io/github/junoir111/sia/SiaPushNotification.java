package io.github.junoir111.sia;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Notification NEUTRE : titre « SIA », texte fixe « Du nouveau ». Aucun contenu du signal reçu n'est lu ni affiché
 * (PRD F12 : jamais de texte de message). Visibilité privée sur l'écran verrouillé. Une seule notification, remplacée à chaque signal.
 * Le canal « sia_nouveautes » doit exister AVANT l'arrivée d'une notification envoyée par Google (la passerelle le nomme).
 */
final class SiaPushNotification {
    static final String CANAL = "sia_nouveautes";
    private static final int IDENTIFIANT = 1;
    private static final String TITRE = "SIA";
    private static final String TEXTE = "Du nouveau";

    private SiaPushNotification() {}

    /** Crée le canal (sans effet s'il existe déjà). */
    static void creerCanal(Context contexte) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel canal =
                new NotificationChannel(CANAL, "Nouveautés", NotificationManager.IMPORTANCE_DEFAULT);
        canal.setDescription("Prévient qu'il y a du nouveau, sans aucun texte.");
        canal.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        canal.setShowBadge(false);
        canal.enableVibration(true);
        NotificationManager gestionnaire = contexte.getSystemService(NotificationManager.class);
        if (gestionnaire != null) gestionnaire.createNotificationChannel(canal);
    }

    private static NotificationCompat.Builder neutre(Context contexte) {
        return new NotificationCompat.Builder(contexte, CANAL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(TITRE)
                .setContentText(TEXTE)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
    }

    static void afficher(Context contexte) {
        creerCanal(contexte);
        Intent ouvrir = new Intent(contexte, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent intention = PendingIntent.getActivity(
                contexte, 0, ouvrir, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification publique = neutre(contexte).build();
        Notification notification = neutre(contexte)
                .setPublicVersion(publique)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(intention)
                .build();
        try {
            NotificationManagerCompat.from(contexte).notify(IDENTIFIANT, notification);
        } catch (SecurityException refuse) {
            // Autorisation de notifier refusée par l'utilisateur : rien à afficher.
        }
    }

    static void retirer(Context contexte) {
        NotificationManagerCompat.from(contexte).cancel(IDENTIFIANT);
    }

    /** Toutes les notifications de SIA (celles de Google comprises) : elles ne disent que « du nouveau », inutiles une fois l'appli ouverte. */
    static void retirerTout(Context contexte) {
        NotificationManagerCompat.from(contexte).cancelAll();
    }
}
