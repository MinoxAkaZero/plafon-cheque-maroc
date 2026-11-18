package ma.plafondcheque.pro;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureVaultKeystorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
