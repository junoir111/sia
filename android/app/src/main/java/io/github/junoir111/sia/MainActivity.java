package io.github.junoir111.sia;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // FLAG_SECURE : pas de capture d'écran, pas d'aperçu dans la liste des applis récentes.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        registerPlugin(SiaPushPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
