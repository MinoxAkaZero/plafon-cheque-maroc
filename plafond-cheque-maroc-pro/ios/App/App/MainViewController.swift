import UIKit
import Capacitor

/**
 * Custom Capacitor bridge view controller for PlafondChèque Maroc Pro (v12.5.0).
 * Explicitly registers the app-local `SecureVaultKeystorePlugin` (Keychain) with the
 * Capacitor 6 bridge so JavaScript can invoke `Capacitor.Plugins.SecureVaultKeystore.{set,get,remove}()`.
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SecureVaultKeystorePlugin())
    }
}
