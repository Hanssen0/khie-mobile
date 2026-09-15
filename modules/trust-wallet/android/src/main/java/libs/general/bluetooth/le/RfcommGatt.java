package libs.general.bluetooth.le;

import android.annotation.*;
import android.util.*;
import java.util.*;

@SuppressLint({ "InlinedApi" })
public class RfcommGatt implements SyncBluetoothGatt.Listener
{
    public static int CONNECTION_PARAM_UPDATE_REQ_DELAY;
    private static final String TAG = "RfcommGatt";
    private SyncBluetoothGatt mSyncGatt;
    private byte[] mResponse;
    private int mMillis;
    private int mGattStatus;
    private int mFeedback;

    static {
        RfcommGatt.CONNECTION_PARAM_UPDATE_REQ_DELAY = 500;
    }

    protected RfcommGatt(final SyncBluetoothGatt syncGatt) {
        this.mMillis = 25000;
        this.mGattStatus = -1;
        this.mFeedback = -1;
        (this.mSyncGatt = syncGatt).setListener(this);
    }

    public int connect(final int millis) throws InterruptedException, IllegalArgumentException {
        int retCode = this.mSyncGatt.connect(millis);
        if (retCode != 0) {
            return retCode;
        }
        Log.i("RfcommGatt", "Connection param update delay " + RfcommGatt.CONNECTION_PARAM_UPDATE_REQ_DELAY);
        Thread.sleep(RfcommGatt.CONNECTION_PARAM_UPDATE_REQ_DELAY);
        retCode = this.prepare(millis);
        if (retCode != 0) {
            return retCode;
        }
        return retCode;
    }

    private int prepare(final int millis) throws InterruptedException, IllegalArgumentException {
        Log.i("RfcommGatt", "Discovery Services...");
        int retCode = this.mSyncGatt.discoverServices(Service.ServiceUUID, millis);
        if (retCode != 0) {
            return retCode;
        }
        Log.i("RfcommGatt", "Enable Notification...");
        retCode = this.mSyncGatt.setCharacteristicNotification(Service.Characteristic.NotifyUUID, true, millis);
        if (retCode != 0) {
            return retCode;
        }
        Log.i("RfcommGatt", "Save Write Characteristic...");
        retCode = this.mSyncGatt.setCharacteristicWrite(Service.Characteristic.WriteUUID);
        if (retCode != 0) {
            return retCode;
        }
        return 0;
    }

    public int close(final int millis) throws InterruptedException {
        if (this.mSyncGatt == null) {
            return 0;
        }
        final int retCode = this.mSyncGatt.disconnect(millis);
        this.mSyncGatt.close();
        this.mGattStatus = -1;
        return retCode;
    }

    public byte[] transmit(final byte[] buffer, final int millis) throws InterruptedException, IllegalArgumentException, GattError {
        return this.transmit(buffer, 0, buffer.length, millis);
    }

    public byte[] transmit(final byte[] buffer, final int offset, final int length, final int millis) throws InterruptedException, IllegalArgumentException, GattError {
        this.reset();
        final int retCode = this.mSyncGatt.write(buffer, offset, length, millis);
        if (retCode != 0) {
            throw new GattError("SyncBluetoothGatt.write failure", retCode);
        }
        Log.i("RfcommGatt", "Wait Response...");
        synchronized (this) {
            if (this.mResponse == null) {
                this.wait(this.mMillis);
            }
        }
        if (!this.mSyncGatt.isConnected()) {
            throw new GattError("Gatt Connection Broken", this.mGattStatus);
        }
        this.check();
        return this.mResponse;
    }

    public void setRecvTimeout(final int millis) throws IllegalArgumentException {
        if (millis < 0) {
            throw new IllegalArgumentException("millis<0");
        }
        this.mMillis = millis;
    }

    public void logOn(final boolean on) {
        this.mSyncGatt.logOn(on);
    }

    @Override
    public void onConnectionStateChange(final int status, final int newState) {
        synchronized (this) {
            this.mGattStatus = status;
            this.notifyAll();
        }
        Log.i("RfcommGatt", "SyncGatt.onConnectionStateChange called, status=" + status + ", newState=" + newState);
    }

    @Override
    public void onReceiveData(final byte[] data, final int feedback) {
        Log.i("RfcommGatt", "onReceiveData:feedback=" + feedback);
        synchronized (this) {
            this.mFeedback = feedback;
            this.mResponse = data;
            this.notifyAll();
        }
    }

    private synchronized void check() throws GattError {
        if (this.mResponse == null) {
            throw new GattError("Recv Response Timeout", 100000);
        }
        if (this.mFeedback != 0) {
            throw new GattError("Response Verification Failure", this.mFeedback);
        }
    }

    private synchronized void reset() {
        this.mResponse = null;
        this.mFeedback = -1;
    }

    public static class Service
    {
        public static UUID ServiceUUID;

        static {
            Service.ServiceUUID = UUID.fromString("0000CC01-0000-1000-8000-00805f9b34fb");
        }

        public static class Characteristic
        {
            public static UUID WriteUUID;
            public static UUID NotifyUUID;

            static {
                Characteristic.WriteUUID = UUID.fromString("0000CD20-0000-1000-8000-00805f9b34fb");
                Characteristic.NotifyUUID = UUID.fromString("0000CD01-0000-1000-8000-00805f9b34fb");
            }
        }
    }
}
