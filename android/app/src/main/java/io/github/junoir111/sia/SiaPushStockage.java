package io.github.junoir111.sia;

import android.content.Context;
import android.content.SharedPreferences;

/** Petit stockage privé (dans l'appli, hors sauvegarde) : seulement l'adresse de réception donnée par le distributeur. */
final class SiaPushStockage {
    private static final String FICHIER = "sia_push";
    private static final String CLE_ENDPOINT = "endpoint";

    private SiaPushStockage() {}

    private static SharedPreferences prefs(Context contexte) {
        return contexte.getApplicationContext().getSharedPreferences(FICHIER, Context.MODE_PRIVATE);
    }

    static String lireEndpoint(Context contexte) {
        return prefs(contexte).getString(CLE_ENDPOINT, null);
    }

    static void ecrireEndpoint(Context contexte, String endpoint) {
        prefs(contexte).edit().putString(CLE_ENDPOINT, endpoint).apply();
    }

    static void effacerEndpoint(Context contexte) {
        prefs(contexte).edit().remove(CLE_ENDPOINT).apply();
    }
}
