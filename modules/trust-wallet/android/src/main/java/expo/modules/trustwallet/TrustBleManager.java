package expo.modules.trustwallet;

import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.content.Context;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import libs.general.bluetooth.le.GattError;
import libs.general.bluetooth.le.datagram.BluetoothDatagram;
import libs.general.bluetooth.le.datagram.BluetoothDatagramFactory;
import libs.general.util.XOR;
import no.nordicsemi.android.ble.BleManager;
import no.nordicsemi.android.ble.data.Data;

/**
 * GATT transport for the Cryptape Trust protocol.
 *
 * <p>The hardware protocol above this class is deliberately synchronous. This adapter keeps that
 * boundary for the legacy command implementation while delegating every BLE operation to Nordic's
 * serialized request queue. It never blocks the Android main thread.</p>
 */
public final class TrustBleManager extends BleManager {
  private static final int GATT_TIMEOUT = 100000;
  private static final int GATT_CONNECTION_INTERRUPTED = 100001;

  private static final UUID SERVICE_UUID = UUID.fromString("0000CC01-0000-1000-8000-00805f9b34fb");
  private static final UUID WRITE_UUID = UUID.fromString("0000CD20-0000-1000-8000-00805f9b34fb");
  private static final UUID NOTIFY_UUID = UUID.fromString("0000CD01-0000-1000-8000-00805f9b34fb");

  private BluetoothGattCharacteristic writeCharacteristic;
  private BluetoothGattCharacteristic notifyCharacteristic;
  private BluetoothDatagram responseDatagram = BluetoothDatagramFactory.createDatagram(0, new XOR());
  private PendingResponse pendingResponse;
  private volatile boolean disconnected;
  private final Object transmitLock = new Object();

  public TrustBleManager(final Context context) {
    super(context.getApplicationContext());
  }

  @Override
  protected boolean isRequiredServiceSupported(final BluetoothGatt gatt) {
    final BluetoothGattService service = gatt.getService(SERVICE_UUID);
    if (service == null) return false;
    writeCharacteristic = service.getCharacteristic(WRITE_UUID);
    notifyCharacteristic = service.getCharacteristic(NOTIFY_UUID);
    return writeCharacteristic != null && notifyCharacteristic != null;
  }

  @Override
  protected void initialize() {
    setNotificationCallback(notifyCharacteristic).with((device, data) -> onNotification(data));
    enableNotifications(notifyCharacteristic).enqueue();
  }

  @Override
  protected void onServicesInvalidated() {
    writeCharacteristic = null;
    notifyCharacteristic = null;
    synchronized (this) {
      disconnected = true;
      if (pendingResponse != null) pendingResponse.fail(GATT_CONNECTION_INTERRUPTED);
    }
  }

  public int open(final BluetoothDevice device, final int timeoutMs) throws InterruptedException {
    assertWorkerThread();
    disconnected = false;
    final Operation operation = new Operation();
    connect(device)
        .timeout(timeoutMs)
        .retry(1, 250)
        .done(ignored -> operation.succeed())
        .fail((ignored, status) -> operation.fail(status))
        .enqueue();
    return operation.await(timeoutMs);
  }

  public byte[] transmit(final byte[] buffer, final int timeoutMs)
      throws InterruptedException, GattError {
    synchronized (transmitLock) {
      return transmitSerially(buffer, timeoutMs);
    }
  }

  private byte[] transmitSerially(final byte[] buffer, final int timeoutMs)
      throws InterruptedException, GattError {
    assertWorkerThread();
    if (!isReady() || writeCharacteristic == null || notifyCharacteristic == null || disconnected) {
      throw new GattError("Gatt Connection Broken", GATT_CONNECTION_INTERRUPTED);
    }

    final PendingResponse response = new PendingResponse();
    synchronized (this) {
      pendingResponse = response;
    }
    final List<byte[]> packets = BluetoothDatagramFactory
        .createDatagram(0, Arrays.copyOf(buffer, buffer.length), new XOR())
        .split(BluetoothDatagram.MAX_CHARACTERISTIC_SIZE);

    for (final byte[] packet : packets) {
      final Operation write = new Operation();
      // Preserve the write type advertised by the legacy device. In particular, CD20 may use
      // WRITE_TYPE_NO_RESPONSE; forcing a write request causes GATT_NO_RESOURCES on the wallet.
      writeCharacteristic(writeCharacteristic, packet)
          .done(ignored -> write.succeed())
          .fail((ignored, status) -> write.fail(status))
          .enqueue();
      final int status = write.await(timeoutMs);
      if (status != BluetoothGatt.GATT_SUCCESS) {
        synchronized (this) {
          pendingResponse = null;
        }
        throw new GattError("Bluetooth wallet write failed", status);
      }
    }

    final int status = response.await(timeoutMs);
    synchronized (this) {
      pendingResponse = null;
    }
    if (status == GATT_TIMEOUT) throw new GattError("Recv Response Timeout", status);
    if (status != BluetoothGatt.GATT_SUCCESS) {
      throw new GattError("Response Verification Failure", status);
    }
    return response.data;
  }

  public int close(final int timeoutMs) throws InterruptedException {
    assertWorkerThread();
    final Operation operation = new Operation();
    disconnect()
        .done(ignored -> operation.succeed())
        .fail((ignored, status) -> operation.fail(status))
        .enqueue();
    final int status = operation.await(timeoutMs);
    super.close();
    return status;
  }

  private void onNotification(final Data data) {
    final byte[] value = data.getValue();
    if (value == null) return;
    synchronized (this) {
      responseDatagram.parse(value);
      if (!responseDatagram.isEof() || responseDatagram.getData() == null) return;
      final PendingResponse response = pendingResponse;
      if (response != null) response.complete(responseDatagram.getData(), responseDatagram.validate());
      responseDatagram.clear();
    }
  }

  private static void assertWorkerThread() {
    if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
      throw new IllegalStateException("Trust BLE transport cannot run on the main thread");
    }
  }

  private static class Operation {
    private final CountDownLatch latch = new CountDownLatch(1);
    private volatile int status = GATT_TIMEOUT;

    void succeed() { status = BluetoothGatt.GATT_SUCCESS; latch.countDown(); }
    void fail(final int newStatus) { status = newStatus; latch.countDown(); }

    int await(final int timeoutMs) throws InterruptedException {
      return latch.await(timeoutMs, TimeUnit.MILLISECONDS) ? status : GATT_TIMEOUT;
    }
  }

  private static final class PendingResponse extends Operation {
    private byte[] data;

    void complete(final byte[] value, final int status) {
      data = Arrays.copyOf(value, value.length);
      if (status == 0) succeed();
      else fail(status);
    }
  }
}
