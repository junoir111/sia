package io.github.junoir111.sia;

import android.content.Context;
import android.content.SharedPreferences;

/** Petit stockage privé (dans l'appli, hors sauvegarde) : seulement le jeton de notification donné par Google (FCM). */
final class SiaPushStockage {
    private static final String FICHIER = "sia_push";
    private static final String CLE_JETON = "jeton";

    private SiaPushStockage() {}

    private static SharedPreferences prefs(Context contexte) {
        return contexte.getApplicationContext().getSharedPreferences(FICHIER, Context.MODE_PRIVATE);
    }

    static String lireJeton(Context contexte) {
        return prefs(contexte).getString(CLE_JETON, null);
    }

    static void ecrireJeton(Context contexte, String jeton) {
        prefs(contexte).edit().putString(CLE_JETON, jeton).apply();
    }

    static void effacerJeton(Context contexte) {
        prefs(contexte).edit().remove(CLE_JETON).apply();
    }
}
