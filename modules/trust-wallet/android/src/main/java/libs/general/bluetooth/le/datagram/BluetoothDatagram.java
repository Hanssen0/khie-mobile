package libs.general.bluetooth.le.datagram;

import android.annotation.*;
import java.io.*;
import java.util.*;

@SuppressLint({ "NewApi", "UseValueOf" })
public class BluetoothDatagram
{
    public static final int MAX_DATA_SIZE = 1024;
    public static int MAX_CHARACTERISTIC_SIZE;
    protected ByteArrayOutputStream mOutput;
    protected byte[] mData;
    protected boolean mIsEof;
    protected ArrayList<Byte> mBuffer;

    static {
        BluetoothDatagram.MAX_CHARACTERISTIC_SIZE = 20;
    }

    public static BluetoothDatagram newDatagram(final byte[] data) {
        return new BluetoothDatagram(data);
    }

    public static BluetoothDatagram newDatagram() {
        return new BluetoothDatagram();
    }

    BluetoothDatagram() {
        this.mOutput = new ByteArrayOutputStream(1024);
        this.mIsEof = true;
        this.mBuffer = new ArrayList<Byte>();
    }

    BluetoothDatagram(final byte[] data) {
        this.mOutput = new ByteArrayOutputStream(1024);
        this.mIsEof = true;
        this.mBuffer = new ArrayList<Byte>();
        this.encode(data);
    }

    public void encode(final byte[] data) {
        this.mData = data.clone();
        this.mOutput.write(192);
        byte[] mData;
        for (int length = (mData = this.mData).length, i = 0; i < length; ++i) {
            final byte oneByte = mData[i];
            switch (oneByte) {
                case -64: {
                    this.mOutput.write(219);
                    this.mOutput.write(220);
                    break;
                }
                case 12: {
                    this.mOutput.write(219);
                    this.mOutput.write(222);
                    break;
                }
                case -37: {
                    this.mOutput.write(219);
                    this.mOutput.write(221);
                    break;
                }
                default: {
                    this.mOutput.write(oneByte);
                    break;
                }
            }
        }
        this.mOutput.write(12);
    }

    public int size() {
        return this.mOutput.size();
    }

    public byte[] toByteArray() {
        return this.mOutput.toByteArray();
    }

    public byte[] getData() {
        return this.mData;
    }

    public void parse(final byte[] datagram) {
        this.parse(datagram, 0, datagram.length);
    }

    public void parse(final byte[] datagram, final int offset, final int count) {
        for (int i = offset; i < count; ++i) {
            switch (datagram[i]) {
                case -64: {
                    this.mOutput.reset();
                    this.mBuffer.clear();
                    this.mIsEof = false;
                    this.mData = null;
                    break;
                }
                case 12: {
                    if (!this.mIsEof) {
                        for (int j = 0; j < this.mBuffer.size(); ++j) {
                            switch (this.mBuffer.get(j)) {
                                case -37: {
                                    switch (this.mBuffer.get(j + 1)) {
                                        case -36: {
                                            this.mOutput.write(192);
                                            ++j;
                                            break;
                                        }
                                        case -35: {
                                            this.mOutput.write(219);
                                            ++j;
                                            break;
                                        }
                                        case -34: {
                                            this.mOutput.write(12);
                                            ++j;
                                            break;
                                        }
                                    }
                                    break;
                                }
                                default: {
                                    this.mOutput.write(this.mBuffer.get(j));
                                    break;
                                }
                            }
                        }
                        this.mIsEof = true;
                        this.mData = this.mOutput.toByteArray();
                        this.mOutput.reset();
                        this.mBuffer.clear();
                        break;
                    }
                    break;
                }
                default: {
                    if (!this.mIsEof) {
                        this.mBuffer.add(new Byte(datagram[i]));
                        break;
                    }
                    break;
                }
            }
        }
    }

    public boolean isEof() {
        return this.mIsEof;
    }

    public List<byte[]> split(final int maxSize) {
        final ArrayList<byte[]> list = new ArrayList<byte[]>();
        final byte[] buffer = this.toByteArray();
        for (int offset = 0; offset <= this.size() && offset != this.size(); offset += maxSize) {
            list.add(Arrays.copyOfRange(buffer, offset, offset + Math.min(buffer.length - offset, maxSize)));
        }
        return list;
    }

    public int validate() {
        return 0;
    }

    public void clear() {
        this.mData = null;
    }
}
