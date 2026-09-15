package libs.general.bluetooth.le.datagram;

import android.annotation.*;
import libs.general.util.*;

import libs.general.util.ChecksumEx;
import libs.opencard.core.util.HexString;

import android.util.*;
import java.util.*;

@SuppressLint({ "NewApi", "UseValueOf" })
public class ChecksumBluetoothDatagram extends BluetoothDatagram
{
    private static final String TAG = "ChecksumBluetoothDatagram";
    public static final int CHECKSUM_ERROR = 100005;
    private ChecksumEx mChecksumEx;

    public static ChecksumBluetoothDatagram newDatagram(final ChecksumEx checksum, final byte[] data) {
        if (checksum.getLength() <= 0) {
            throw new IllegalArgumentException("checksum length <= 0");
        }
        return new ChecksumBluetoothDatagram(checksum, data);
    }

    public static ChecksumBluetoothDatagram newDatagram(final ChecksumEx checksum) {
        if (checksum.getLength() <= 0) {
            throw new IllegalArgumentException("checksum length <= 0");
        }
        return new ChecksumBluetoothDatagram(checksum);
    }

    ChecksumBluetoothDatagram(final ChecksumEx checksum) {
        this.mChecksumEx = checksum;
    }

    ChecksumBluetoothDatagram(final ChecksumEx checksum, final byte[] data) {
        if (data.length == 0) {
            this.encode(data);
            return;
        }
        this.mChecksumEx = checksum;
        final int length = this.mChecksumEx.getLength();
        final byte[] buffer = new byte[data.length + length];
        System.arraycopy(data, 0, buffer, 0, data.length);
        this.mChecksumEx.reset();
        this.mChecksumEx.update(data, 0, data.length);
        for (int i = length, j = data.length; i > 1; --i, ++j) {
            buffer[j] = (byte)(this.mChecksumEx.getValue() >> (i - 1) * 8 & 0xFFL);
        }
        buffer[buffer.length - 1] = (byte)(this.mChecksumEx.getValue() & 0xFFL);
        Log.d("ChecksumBluetoothDatagram", "checksum=" + HexString.hexify((int)this.mChecksumEx.getValue()));
        Log.d("ChecksumBluetoothDatagram", "checksum=" + this.mChecksumEx.getValue());
        this.encode(buffer);
    }

    @Override
    public byte[] getData() {
        if (super.getData() == null) {
            return super.getData();
        }
        final byte[] data = super.getData();
        if (data.length == 0) {
            return data;
        }
        return Arrays.copyOf(data, data.length - this.mChecksumEx.getLength());
    }

    public long getChecksum() {
        final int length = this.mChecksumEx.getLength();
        final byte[] data = super.getData();
        long checksum = 0L;
        for (int i = length, j = data.length - length; i > 1; --i, ++j) {
            checksum += (long)(data[j] & 0xFF) << (i - 1) * 8;
            Log.d("ChecksumBluetoothDatagram", "checksum[" + j + "]=" + HexString.hexify(data[j]));
        }
        checksum += data[data.length - 1];
        return checksum;
    }

    @Override
    public int validate() {
        final byte[] data = this.getData();
        if (data.length == 0) {
            return 0;
        }
        this.mChecksumEx.reset();
        this.mChecksumEx.update(data, 0, data.length);
        Log.d("ChecksumBluetoothDatagram", "validate checksum=" + HexString.hexify((int)this.mChecksumEx.getValue()));
        Log.d("ChecksumBluetoothDatagram", "validate checksum=" + this.mChecksumEx.getValue() + ", " + this.getChecksum());
        if (this.getChecksum() != this.mChecksumEx.getValue()) {
            return 100005;
        }
        if (data.length == 2 && data[0] == 0 && data[1] == -101) {
            return data[1];
        }
        return 0;
    }
}
