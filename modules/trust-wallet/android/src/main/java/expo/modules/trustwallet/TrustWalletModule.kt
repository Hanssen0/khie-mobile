package expo.modules.trustwallet

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import libs.trustconnector.ble.pursesdk.BlePurseSDK
import java.util.concurrent.ConcurrentHashMap

class TrustWalletModule : Module() {
  private val adapter: BluetoothAdapter?
    get() = (appContext.reactContext
      ?.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
  private val mainHandler = Handler(Looper.getMainLooper())
  private var activeScan: ScanCallback? = null

  override fun definition() = ModuleDefinition {
    Name("KhieTrustWallet")

    OnCreate {
      BlePurseSDK.initKey(
        "7404BE01D1C52CDD0DEA7BFAD37B5CD8",
        "121C29F27546F9DCF25E3AB7C116EA61",
        "7377C0D7F2F3A6561FABFD13DFC5E501"
      )
      BlePurseSDK.setDefaultTime(10_000)
    }

    Function("isAvailable") {
      adapter != null
    }

    @SuppressLint("MissingPermission")
    Function("getBluetoothState") {
      val bluetoothAdapter = adapter
      val locationManager = appContext.reactContext
        ?.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
      val locationServicesEnabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        locationManager?.isLocationEnabled == true
      } else {
        locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true ||
          locationManager?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true
      }

      mapOf(
        "available" to (bluetoothAdapter != null),
        "enabled" to (bluetoothAdapter?.isEnabled == true),
        "locationServicesEnabled" to locationServicesEnabled
      )
    }

    AsyncFunction("scan") { durationMs: Int, promise: Promise ->
      startScan(durationMs.coerceIn(1_000, 30_000), promise)
    }

    AsyncFunction("connect") { deviceId: String, pin: String ->
      connect(deviceId, pin)
    }

    AsyncFunction("resetPin") { deviceId: String, puk: String, newPin: String ->
      resetPin(deviceId, puk, newPin)
    }

    AsyncFunction("generateKey") { pin: String ->
      generateKey(pin)
    }

    AsyncFunction("resetKey") { pin: String ->
      resetKey(pin)
    }

    AsyncFunction("importKey") { privateKey: String, publicKey: String, pin: String ->
      importKey(privateKey, publicKey, pin)
    }

    AsyncFunction("disconnect") {
      BlePurseSDK.closeBlePurse()
      Unit
    }

    AsyncFunction("sign") { digest: String, pin: String ->
      sign(digest, pin)
    }

    OnDestroy {
      stopActiveScan()
      BlePurseSDK.closeBlePurse()
    }
  }

  @SuppressLint("MissingPermission")
  private fun startScan(durationMs: Int, promise: Promise) {
    val bluetoothAdapter = adapter
    if (bluetoothAdapter == null) {
      promise.reject("ERR_TRUST_BLUETOOTH_UNAVAILABLE", "Bluetooth is not available", null)
      return
    }
    if (!bluetoothAdapter.isEnabled) {
      promise.reject("ERR_TRUST_BLUETOOTH_DISABLED", "Turn on Bluetooth to find Cryptape Trust devices", null)
      return
    }

    mainHandler.post {
      stopActiveScan()
      val devices = ConcurrentHashMap<String, Map<String, Any>>()
      val scanner = bluetoothAdapter.bluetoothLeScanner
      if (scanner == null) {
        promise.reject("ERR_TRUST_SCAN_FAILED", "Bluetooth LE scanning is unavailable", null)
        return@post
      }
      val callback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
          addDevice(result)
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>) {
          results.forEach(::addDevice)
        }

        override fun onScanFailed(errorCode: Int) {
          mainHandler.post {
            if (activeScan === this) {
              activeScan = null
              promise.reject(
                "ERR_TRUST_SCAN_FAILED",
                "Unable to scan for Cryptape Trust devices (Android error $errorCode)",
                null
              )
            }
          }
        }

        private fun addDevice(result: ScanResult) {
          val device = result.device
          val name = result.scanRecord?.deviceName ?: device.name ?: return
          if (!name.contains("NKey", ignoreCase = true)) {
            return
          }
          devices[device.address] = mapOf(
            "id" to device.address,
            "name" to name,
            "rssi" to result.rssi
          )
        }
      }
      activeScan = callback
      try {
        scanner.startScan(callback)
      } catch (cause: Throwable) {
        activeScan = null
        promise.reject("ERR_TRUST_SCAN_FAILED", cause.message, cause)
        return@post
      }

      mainHandler.postDelayed({
        if (activeScan !== callback) return@postDelayed
        scanner.stopScan(callback)
        activeScan = null
        promise.resolve(devices.values.sortedByDescending { it["rssi"] as Int })
      }, durationMs.toLong())
    }
  }

  @SuppressLint("MissingPermission")
  private fun stopActiveScan() {
    val callback = activeScan ?: return
    activeScan = null
    try {
      adapter?.bluetoothLeScanner?.stopScan(callback)
    } catch (_: Throwable) {
      // The adapter can disappear while Android is revoking Bluetooth access.
    }
  }

  @SuppressLint("MissingPermission")
  private fun connect(deviceId: String, pin: String): Map<String, Any> {
    if (!pin.matches(Regex("^[0-9]{8}$"))) {
      error("Cryptape Trust PIN must contain 8 digits")
    }
    val bluetoothAdapter = adapter ?: error("Bluetooth is not available")
    if (!bluetoothAdapter.isEnabled) {
      error("Turn on Bluetooth to connect Cryptape Trust")
    }
    val device: BluetoothDevice = bluetoothAdapter.getRemoteDevice(deviceId)
    if (!BlePurseSDK.connectPeripheral(requireNotNull(appContext.reactContext), device)) {
      error(BlePurseSDK.getErrMsg().ifBlank { "Unable to connect Cryptape Trust" })
    }
    val pinResult = BlePurseSDK.verifyPIN(pin.toByteArray(Charsets.US_ASCII))
    if (pinResult != 0x9000) {
      val message = BlePurseSDK.getErrMsg().ifBlank { "Cryptape Trust PIN verification failed" }
      BlePurseSDK.closeBlePurse()
      error("$message (device status ${pinResult.toString(16).uppercase()})")
    }
    val publicKey = BlePurseSDK.getPublicKey()
    return mutableMapOf<String, Any>(
      "id" to device.address,
      "name" to (device.name ?: "Cryptape Trust")
    ).apply {
      if (publicKey != null) put("publicKey", publicKey.toHex())
    }
  }

  @SuppressLint("MissingPermission")
  private fun resetPin(deviceId: String, puk: String, newPin: String) {
    if (!puk.matches(Regex("^[0-9a-fA-F]{16}$"))) {
      error("Cryptape Trust PUK must contain 16 hexadecimal characters")
    }
    if (!newPin.matches(Regex("^[0-9]{8}$"))) {
      error("Cryptape Trust PIN must contain 8 digits")
    }
    val bluetoothAdapter = adapter ?: error("Bluetooth is not available")
    if (!bluetoothAdapter.isEnabled) {
      error("Turn on Bluetooth to connect Cryptape Trust")
    }
    val device: BluetoothDevice = bluetoothAdapter.getRemoteDevice(deviceId)
    if (!BlePurseSDK.connectPeripheral(requireNotNull(appContext.reactContext), device)) {
      error(BlePurseSDK.getErrMsg().ifBlank { "Unable to connect Cryptape Trust" })
    }
    try {
      val result = BlePurseSDK.unblockPIN(
        puk.hexBytes(),
        newPin.toByteArray(Charsets.US_ASCII)
      )
      if (result != 0x9000) {
        val message = BlePurseSDK.getErrMsg().ifBlank { "Unable to reset the Cryptape Trust PIN" }
        error("$message (device status ${result.toString(16).uppercase()})")
      }
    } finally {
      BlePurseSDK.closeBlePurse()
    }
  }

  private fun sign(digest: String, pin: String): String {
    if (!pin.matches(Regex("^[0-9]{8}$"))) {
      error("Cryptape Trust PIN must contain 8 digits")
    }
    val digestBytes = digest.hexBytes()
    if (digestBytes.size != 32) {
      error("Cryptape Trust signing digest must contain 32 bytes")
    }
    val pinResult = BlePurseSDK.verifyPIN(pin.toByteArray(Charsets.US_ASCII))
    if (pinResult != 0x9000) {
      error(BlePurseSDK.getErrMsg().ifBlank { "Cryptape Trust PIN verification failed" })
    }
    return (BlePurseSDK.sign(digestBytes)
      ?: error(BlePurseSDK.getErrMsg().ifBlank { "Cryptape Trust signing failed" })).toHex()
  }

  private fun generateKey(pin: String): String {
    verifyPin(pin)
    check(BlePurseSDK.getPublicKey() == null) {
      "Cryptape Trust already contains a key"
    }
    val result = BlePurseSDK.generateKey()
    check(result == 0x9000) {
      BlePurseSDK.getErrMsg().ifBlank { "Unable to generate a Cryptape Trust key" }
    }
    return BlePurseSDK.getPublicKey()?.toHex()
      ?: error("Cryptape Trust generated a key but did not return its public key")
  }

  private fun resetKey(pin: String) {
    verifyPin(pin)
    val result = BlePurseSDK.resetKey()
    check(result == 0x9000) {
      BlePurseSDK.getErrMsg().ifBlank { "Unable to reset the Cryptape Trust key" }
    }
  }

  private fun importKey(privateKey: String, publicKey: String, pin: String): String {
    verifyPin(pin)
    check(BlePurseSDK.getPublicKey() == null) {
      "Cryptape Trust already contains a key"
    }
    val privateKeyBytes = privateKey.hexBytes()
    val publicKeyBytes = publicKey.hexBytes()
    require(privateKeyBytes.size == 32) {
      "Cryptape Trust private key must contain 32 bytes"
    }
    require(publicKeyBytes.size == 64) {
      "Cryptape Trust public key must contain 64 bytes"
    }
    try {
      val result = BlePurseSDK.importKey(privateKeyBytes, publicKeyBytes)
      check(result == 0x9000) {
        BlePurseSDK.getErrMsg().ifBlank { "Unable to import the Cryptape Trust key" }
      }
      val importedPublicKey = BlePurseSDK.getPublicKey()
        ?: error("Cryptape Trust imported a key but did not return its public key")
      check(importedPublicKey.contentEquals(publicKeyBytes)) {
        "Cryptape Trust returned a different public key after import"
      }
      return importedPublicKey.toHex()
    } finally {
      privateKeyBytes.fill(0)
    }
  }

  private fun verifyPin(pin: String) {
    require(pin.matches(Regex("^[0-9]{8}$"))) {
      "Cryptape Trust PIN must contain 8 digits"
    }
    val result = BlePurseSDK.verifyPIN(pin.toByteArray(Charsets.US_ASCII))
    check(result == 0x9000) {
      BlePurseSDK.getErrMsg().ifBlank { "Cryptape Trust PIN verification failed" }
    }
  }
}

private fun String.hexBytes(): ByteArray {
  val normalized = removePrefix("0x")
  require(normalized.length % 2 == 0 && normalized.matches(Regex("^[0-9a-fA-F]+$"))) {
    "Invalid hexadecimal data"
  }
  return ByteArray(normalized.length / 2) { index ->
    normalized.substring(index * 2, index * 2 + 2).toInt(16).toByte()
  }
}

private fun ByteArray.toHex(): String = joinToString(prefix = "0x", separator = "") {
  "%02x".format(it.toInt() and 0xff)
}
