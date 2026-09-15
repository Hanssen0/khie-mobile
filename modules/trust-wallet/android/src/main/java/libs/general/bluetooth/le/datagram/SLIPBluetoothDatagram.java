package libs.general.bluetooth.le.datagram;

import android.annotation.*;

@SuppressLint({ "NewApi" })
public class SLIPBluetoothDatagram extends BluetoothDatagram
{
    public static SLIPBluetoothDatagram newDatagram(final byte[] data) {
        return new SLIPBluetoothDatagram(data);
    }

    public static SLIPBluetoothDatagram newDatagram() {
        return new SLIPBluetoothDatagram();
    }

    SLIPBluetoothDatagram() {
    }

    SLIPBluetoothDatagram(final byte[] data) {
        this.encode(data);
    }

    @Override
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
        this.mOutput.write(192);
    }

    @SuppressLint({ "UseValueOf" })
    @Override
    public void parse(final byte[] datagram, final int offset, final int count) {
        for (int i = offset; i < count; ++i) {
            switch (datagram[i]) {
                case -64: {
                    if (this.mIsEof) {
                        this.mOutput.reset();
                        this.mBuffer.clear();
                        this.mIsEof = false;
                        break;
                    }
                    this.mIsEof = true;
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
                                }
                                break;
                            }
                            default: {
                                this.mOutput.write(this.mBuffer.get(j));
                                break;
                            }
                        }
                    }
                    this.mData = this.mOutput.toByteArray();
                    break;
                }
                default: {
                    this.mBuffer.add(new Byte(datagram[i]));
                    break;
                }
            }
        }
    }
}
