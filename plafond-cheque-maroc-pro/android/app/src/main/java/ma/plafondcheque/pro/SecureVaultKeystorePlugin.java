package ma.plafondcheque.pro;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Hardware-backed Android Keystore plugin for PlafondChèque Maroc Pro (v12.5.1).
 * Wraps and unwraps the 256-bit Data Encryption Key (DEK) using a non-exportable
 * AES-256-GCM master key inside the Android Hardware Keystore ("AndroidKeyStore").
 */
@CapacitorPlugin(name = "SecureVaultKeystore")
public class SecureVaultKeystorePlugin extends Plugin {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String MASTER_KEY_ALIAS = "ma.plafondcheque.pro.hardware_master_key_v11";
    private static final String PREFS_NAME = "pcm_hardware_keystore_prefs_v11";

    private SecretKey getOrCreateHardwareMasterKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(MASTER_KEY_ALIAS)) {
            KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(MASTER_KEY_ALIAS, null);
            return entry.getSecretKey();
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                MASTER_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || key.isEmpty() || value == null) {
            call.reject("Missing key or value parameter");
            return;
        }
        try {
            SecretKey masterKey = getOrCreateHardwareMasterKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, masterKey);
            byte[] iv = cipher.getIV();
            byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));

            String payload = Base64.encodeToString(iv, Base64.NO_WRAP) + ":" +
                             Base64.encodeToString(ciphertext, Base64.NO_WRAP);
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            boolean committed = prefs.edit().putString(key, payload).commit();
            if (!committed) {
                call.reject("Failed to commit wrapped key to SharedPreferences");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("value", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("AndroidKeyStore encryption error: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("Missing key parameter");
            return;
        }
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String payload = prefs.getString(key, null);
            if (payload == null || !payload.contains(":")) {
                call.reject("Key not found in AndroidKeyStore vault");
                return;
            }
            String[] parts = payload.split(":", 2);
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);

            SecretKey masterKey = getOrCreateHardwareMasterKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, masterKey, new GCMParameterSpec(128, iv));
            byte[] plainBytes = cipher.doFinal(ciphertext);

            JSObject ret = new JSObject();
            ret.put("value", new String(plainBytes, StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("AndroidKeyStore decryption error: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("Missing key parameter");
            return;
        }
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(key).commit();
        JSObject ret = new JSObject();
        ret.put("value", true);
        call.resolve(ret);
    }
}
