package libs.general.bluetooth.le;

import android.annotation.*;
import android.content.*;
import libs.general.util.*;
import libs.general.bluetooth.le.datagram.*;

import libs.general.bluetooth.le.datagram.BluetoothDatagram;
import libs.general.bluetooth.le.datagram.BluetoothDatagramFactory;
import libs.general.util.XOR;
import libs.opencard.core.util.HexString;

import android.util.*;
import android.bluetooth.*;

import java.util.*;

@SuppressLint({ "NewApi" })
public class SyncBluetoothGatt extends BluetoothGattCallback
{
    private static final String TAG = "SyncBluetoothGatt";
    private static final int PROTOCOL = 0;
    private BluetoothDatagram mDatagram;
    private BluetoothGattCharacteristic mCharacteristic;
    private BluetoothGattService mService;
    private BluetoothDevice mDevice;
    private BluetoothGatt mGatt;
    private Context mContext;
    private Listener mListener;
    private UUID mServiceUuid;
    private final Object mStateLock;
    private int mConnState;
    private boolean mNotifyEnabled;
    private boolean mWritten;
    private boolean mLogOn;
    private int mAsyncStatus;

    protected SyncBluetoothGatt(final Context context, final BluetoothDevice device) {
        this.mDatagram = BluetoothDatagramFactory.createDatagram(0, new XOR());
        this.mStateLock = new Object();
        this.mConnState = 0;
        this.mNotifyEnabled = false;
        this.mWritten = false;
        this.mLogOn = false;
        this.mAsyncStatus = 0;
        this.mContext = context;
        this.mDevice = device;
    }

    public int connect(final int millis) throws InterruptedException, IllegalArgumentException {
        if (millis < 0) {
            throw new IllegalArgumentException("millis < 0");
        }
        this.mAsyncStatus = -1;
        this.mGatt = this.mDevice.connectGatt(this.mContext, false, (BluetoothGattCallback)this);
        if (this.mGatt == null) {
            throw new NullPointerException("connectGatt return null");
        }
        Log.i("SyncBluetoothGatt", "Wait onConnectionStateChange " + millis + " ms");
        synchronized (this.mStateLock) {
            if (!this.isConnected()) {
                this.mStateLock.wait(millis);
            }
        }
        // monitorexit(this.mStateLock)
        Log.i("SyncBluetoothGatt", "Wakeup");
        if (this.isConnected()) {
            return 0;
        }
        return (this.mAsyncStatus == -1) ? 100000 : this.mAsyncStatus;
    }

    public int disconnect(final int millis) throws InterruptedException {
        if (this.mGatt == null) {
            return 0;
        }
        if (millis < 0) {
            throw new IllegalArgumentException("millis < 0");
        }
        this.mAsyncStatus = -1;
        this.mGatt.disconnect();
        synchronized (this.mStateLock) {
            if (this.isConnected()) {
                this.mStateLock.wait(millis);
            }
        }
        // monitorexit(this.mStateLock)
        if (!this.isConnected()) {
            Log.i("SyncBluetoothGatt", "Gatt Disconnected");
            return 0;
        }
        final int retCode = (this.mAsyncStatus == -1) ? 100000 : this.mAsyncStatus;
        Log.i("SyncBluetoothGatt", "Gatt Disconnect Failed, status=" + retCode);
        return retCode;
    }

    public void close() {
        if (this.mGatt == null) {
            return;
        }
        this.mGatt.close();
        this.mGatt = null;
        this.mService = null;
        this.mConnState = 0;
        this.mAsyncStatus = -1;
        Log.i("SyncBluetoothGatt", "Gatt Closed");
    }

    public int discoverServices(final UUID serviceUuid, final int millis) throws InterruptedException, IllegalArgumentException {
        if (millis < 0) {
            throw new IllegalArgumentException("millis < 0");
        }
        this.mServiceUuid = serviceUuid;
        this.mAsyncStatus = -1;
        if (!this.mGatt.discoverServices()) {
            Log.e("SyncBluetoothGatt", "Discover services failed");
            return 257;
        }
        Log.i("SyncBluetoothGatt", "Wait onServicesDiscovered " + millis + " ms");
        synchronized (this.mStateLock) {
            if (this.mService == null) {
                this.mStateLock.wait(millis);
            }
        }
        // monitorexit(this.mStateLock)
        Log.i("SyncBluetoothGatt", "Wakeup");
        if (!this.isConnected()) {
            Log.e("SyncBluetoothGatt", "Gatt Connection Disconnected");
            return 100001;
        }
        if (this.mService != null) {
            return 0;
        }
        Log.e("SyncBluetoothGatt", "mService is null");
        Log.e("SyncBluetoothGatt", String.format("Gatt Service %s Not Found", serviceUuid.toString()));
        return (this.mAsyncStatus == -1) ? 100000 : 100002;
    }

    public int setCharacteristicNotification(final UUID notifyUuid, final boolean enable, final int millis) throws InterruptedException, IllegalArgumentException {
        if (millis < 0) {
            throw new IllegalArgumentException("millis < 0");
        }
        if (this.mService == null) {
            return 100002;
        }
        final BluetoothGattCharacteristic characteristic = this.mService.getCharacteristic(notifyUuid);
        if (characteristic == null) {
            Log.e("SyncBluetoothGatt", String.format("Gatt Characteristic %s Not Found", notifyUuid.toString()));
            return 100003;
        }
        if (!this.mGatt.setCharacteristicNotification(characteristic, true)) {
            Log.e("SyncBluetoothGatt", String.format("setCharacteristicNotification failed", new Object[0]));
            return 257;
        }
        final UUID descriptorUUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
        final BluetoothGattDescriptor descriptor = characteristic.getDescriptor(descriptorUUID);
        if (descriptor == null) {
            Log.e("SyncBluetoothGatt", String.format("Gatt Descriptor %s Not Found", descriptorUUID.toString()));
            return 100004;
        }
        if (enable) {
            if ((characteristic.getProperties() & 0x10) == 0x10) {
                descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            }
            if ((characteristic.getProperties() & 0x20) == 0x20) {
                descriptor.setValue(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE);
            }
        }
        else if ((characteristic.getProperties() & 0x10) == 0x10) {
            descriptor.setValue(BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE);
        }
        this.mAsyncStatus = -1;
        this.mNotifyEnabled = false;
        if (!this.mGatt.writeDescriptor(descriptor)) {
            Log.e("SyncBluetoothGatt", String.format("writeDescriptor failed", new Object[0]));
            return 257;
        }
        Log.i("SyncBluetoothGatt", "Wait onDescriptorWrite " + millis + " ms");
        synchronized (this.mStateLock) {
            if (!this.mNotifyEnabled) {
                this.mStateLock.wait(millis);
            }
        }
        // monitorexit(this.mStateLock)
        Log.i("SyncBluetoothGatt", "Wakeup");
        if (!this.isConnected()) {
            Log.e("SyncBluetoothGatt", "Gatt Connection Disconnected");
            return 100001;
        }
        if (this.mNotifyEnabled) {
            return 0;
        }
        return (this.mAsyncStatus == -1) ? 100000 : this.mAsyncStatus;
    }

    public int setCharacteristicWrite(final UUID writeUuid) {
        if (this.mService == null) {
            Log.e("SyncBluetoothGatt", String.format("Gatt Service %s Not Found", this.mServiceUuid.toString()));
            return 100002;
        }
        this.mCharacteristic = this.mService.getCharacteristic(writeUuid);
        if (this.mCharacteristic == null) {
            Log.e("SyncBluetoothGatt", String.format("Gatt Characteristic %s Not Found", this.mCharacteristic.getUuid().toString()));
            return 100003;
        }
        return 0;
    }

    public int write(final byte[] buffer, final int millis) throws InterruptedException, IllegalArgumentException {
        return this.write(buffer, 0, buffer.length, millis);
    }

    @SuppressLint({ "NewApi" })
    public int write(final byte[] buffer, final int offset, final int length, final int millis) throws InterruptedException, IllegalArgumentException {
        if (millis < 0) {
            throw new IllegalArgumentException("millis<0");
        }
        if (offset < 0 || length < 0) {
            throw new IllegalArgumentException("offset<0 or length<0");
        }
        final List<byte[]> list = BluetoothDatagramFactory.createDatagram(0, Arrays.copyOfRange(buffer, offset, length), new XOR()).split(BluetoothDatagram.MAX_CHARACTERISTIC_SIZE);
        int retCode = -1;
        if (this.mLogOn) {
            Log.i("SyncBluetoothGatt", "Request =[" + HexString.toHexString(buffer, offset, length) + "]");
        }
        for (int i = 0; i < list.size(); ++i) {
            this.mCharacteristic.setValue((byte[])list.get(i));
            retCode = this.writeCharacteristic(this.mCharacteristic, millis);
            if (retCode != 0) {
                return retCode;
            }
        }
        return retCode;
    }

    public int requestMtu(final int mtu) {
        throw new UnsupportedOperationException("BluetoothGattConnection.requestMtu Unsupported");
    }

    public synchronized boolean isConnected() {
        return this.mConnState == 2;
    }

    public void logOn(final boolean on) {
        this.mLogOn = on;
    }

    public void setListener(final Listener listener) {
        this.mListener = listener;
    }

    @SuppressLint({ "NewApi" })
    public BluetoothDevice getRemoteDevice() {
        if (this.mGatt != null) {
            return this.mGatt.getDevice();
        }
        return null;
    }

    public BluetoothGatt getGatt() {
        return this.mGatt;
    }

    private int writeCharacteristic(final BluetoothGattCharacteristic characteristic, final int millis) throws InterruptedException {
        this.mAsyncStatus = -1;
        this.mWritten = false;
        if (this.mLogOn) {
            Log.i("SyncBluetoothGatt", "writeCharacteristic: " + HexString.hexify(characteristic.getValue()));
        }
        if (!this.mGatt.writeCharacteristic(characteristic)) {
            Log.e("SyncBluetoothGatt", "writeCharacteristic return false");
            return 257;
        }
        Log.i("SyncBluetoothGatt", "Wait onCharacteristicWrite " + millis + " ms");
        synchronized (this.mStateLock) {
            if (!this.mWritten) {
                this.mStateLock.wait(millis);
            }
        }
        // monitorexit(this.mStateLock)
        Log.i("SyncBluetoothGatt", "Wakeup");
        if (!this.isConnected()) {
            Log.e("SyncBluetoothGatt", "Gatt Connection Broken");
            return 100001;
        }
        if (this.mWritten) {
            return 0;
        }
        return (this.mAsyncStatus == -1) ? 100000 : this.mAsyncStatus;
    }

    @SuppressLint({ "NewApi" })
    public void onCharacteristicChanged(final BluetoothGatt gatt, final BluetoothGattCharacteristic characteristic) {
        if (this.mLogOn) {
            Log.i("SyncBluetoothGatt", "onCharacteristicChanged: " + HexString.hexify(characteristic.getValue()));
        }
        this.mDatagram.parse(characteristic.getValue());
        if (this.mDatagram.isEof() && this.mDatagram.getData() != null) {
            if (this.mListener != null) {
                Log.i("SyncBluetoothGatt", "Call Listener.onReceiveData");
                if (this.mLogOn) {
                    Log.i("SyncBluetoothGatt", "Response=[" + HexString.toHexString(this.mDatagram.getData()) + "]");
                }
                this.mListener.onReceiveData(this.mDatagram.getData(), this.mDatagram.validate());
            }
            this.mDatagram.clear();
        }
    }

    public void onCharacteristicWrite(final BluetoothGatt gatt, final BluetoothGattCharacteristic characteristic, final int status) {
        Log.i("SyncBluetoothGatt", "onCharacteristicWrite called, status=" + status);
        synchronized (this.mStateLock) {
            this.mAsyncStatus = status;
            if (status == 0) {
                if (characteristic.getUuid().compareTo(this.mCharacteristic.getUuid()) == 0) {
                    this.mWritten = true;
                }
                Log.i("SyncBluetoothGatt", "Characteristic " + characteristic.getUuid().toString() + " write success");
            }
            else {
                Log.e("SyncBluetoothGatt", "Characteristic " + this.mCharacteristic.getUuid().toString() + " write failure, status: " + status);
            }
            this.mStateLock.notifyAll();
        }
        // monitorexit(this.mStateLock)
    }

    public void onConnectionStateChange(final BluetoothGatt gatt, final int status, final int newState) {
        Log.i("SyncBluetoothGatt", String.format("SyncBluetoothGatt.onConnectionStateChange called, status=%d, newState=%d", status, newState));
        synchronized (this.mStateLock) {
            this.mAsyncStatus = status;
            if (status == 0) {
                switch (this.mConnState = newState) {
                    case 2: {
                        Log.i("SyncBluetoothGatt", String.format("SyncBluetoothGatt.onConnectionStateChange newState: STATE_CONNECTED", new Object[0]));
                        break;
                    }
                    case 1: {
                        Log.i("SyncBluetoothGatt", String.format("SyncBluetoothGatt.onConnectionStateChange newState: STATE_CONNECTING", new Object[0]));
                        break;
                    }
                    case 0: {
                        Log.i("SyncBluetoothGatt", String.format("SyncBluetoothGatt.onConnectionStateChange newState: STATE_DISCONNECTED", new Object[0]));
                        break;
                    }
                    case 3: {
                        Log.i("SyncBluetoothGatt", String.format("SyncBluetoothGatt.onConnectionStateChange newState: STATE_DISCONNECTING", new Object[0]));
                        break;
                    }
                }
            }
            this.mStateLock.notifyAll();
        }
        // monitorexit(this.mStateLock)
        if (this.mListener != null) {
            this.mListener.onConnectionStateChange(status, newState);
        }
    }

    public void onDescriptorWrite(final BluetoothGatt gatt, final BluetoothGattDescriptor descriptor, final int status) {
        Log.i("SyncBluetoothGatt", String.format("onDescriptorWrite called, status=%d", status));
        synchronized (this.mStateLock) {
            this.mAsyncStatus = status;
            if (status == 0) {
                Log.i("SyncBluetoothGatt", "descriptor " + descriptor.getUuid().toString() + " write success");
                this.mNotifyEnabled = true;
            }
            else {
                Log.e("SyncBluetoothGatt", "descriptor " + descriptor.getUuid().toString() + " write failure, status: " + status);
            }
            this.mStateLock.notifyAll();
        }
        // monitorexit(this.mStateLock)
    }

    public void onMtuChanged(final BluetoothGatt gatt, final int mtu, final int status) {
    }

    public void onServicesDiscovered(final BluetoothGatt gatt, final int status) {
        Log.i("SyncBluetoothGatt", String.format("onServicesDiscovered called, status=%d", status));
        synchronized (this.mStateLock) {
            this.mAsyncStatus = status;
            if (status == 0) {
                if (this.mServiceUuid != null) {
                    this.mService = gatt.getService(this.mServiceUuid);
                }
                Log.i("SyncBluetoothGatt", "Services " + this.mServiceUuid.toString() + " Discovered success");
            }
            else {
                Log.e("SyncBluetoothGatt", "Services " + this.mServiceUuid.toString() + " Discovered failure, status: " + status);
            }
            this.mStateLock.notifyAll();
        }
        // monitorexit(this.mStateLock)
    }

    public static class Errors
    {
        public static final int GATT_SUCCESS = 0;
        public static final int GATT_FAILURE = 257;
        public static final int GATT_TIMEOUT = 100000;
        public static final int GATT_CONNECTION_INTERRUPTED = 100001;
        public static final int GATT_SERVICE_NOT_FOUND = 100002;
        public static final int GATT_CHARACTERISTIC_NOT_FOUND = 100003;
        public static final int GATT_DESCRIPTOR_NOT_FOUND = 100004;
        public static final int GATT_VERIFICATION_FAILURE = 100005;
        public static final int GATT_REMOTE_CHECKSUM_FAILURE = 155;
        static final int GATT_UNKOWN = -1;
    }

    public interface Listener
    {
        void onConnectionStateChange(final int p0, final int p1);

        void onReceiveData(final byte[] p0, final int p1);
    }
}
