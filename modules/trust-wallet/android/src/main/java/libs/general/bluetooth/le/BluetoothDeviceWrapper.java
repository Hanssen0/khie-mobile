package libs.general.bluetooth.le;

import android.bluetooth.*;
import android.content.*;

public class BluetoothDeviceWrapper
{
    public static final String ACTION_DATA_ARRIVED = "com.hed.bluetooth.device.data_arrived";
    public static final String EXTRA_RESPONSE_DATA = "com.hed.bluetooth.device.responsedata";
    protected BluetoothDevice mDevice;
    private int mRssi;

    public BluetoothDeviceWrapper(final BluetoothDevice device) {
        this.mDevice = device;
    }

    public BluetoothDeviceWrapper(final BluetoothDevice device, final int rssi, final byte[] advertiseData) {
        this.mDevice = device;
        this.mRssi = rssi;
    }

    public BluetoothDevice getDevice() {
        return this.mDevice;
    }

    public int getRssi() {
        return this.mRssi;
    }

    public RfcommGatt createRfcommGatt(final Context context) {
        return new RfcommGatt(new SyncBluetoothGatt(context, this.mDevice));
    }
}
