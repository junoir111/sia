package io.github.junoir111.sia;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // FLAG_SECURE : pas de capture d'écran, pas d'aperçu dans la liste des applis récentes.
        // Variante TEST seulement (BuildConfig.SIA_TEST, faux par défaut) : captures et débogage du WebView permis.
        if (!BuildConfig.SIA_TEST) {
            getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        }
        registerPlugin(SiaPushPlugin.class);
        super.onCreate(savedInstanceState);
        // APRÈS super.onCreate : Capacitor règle le débogage du WebView pendant son démarrage ; on impose le nôtre ensuite.
        // Débogage (lecture du jeton et des clés depuis un PC) : variante TEST uniquement, jamais la variante essai.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.SIA_TEST);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Les notifications ne disent que « du nouveau » : inutiles une fois l'appli ouverte.
        SiaPushNotification.retirerTout(this);
    }
}
