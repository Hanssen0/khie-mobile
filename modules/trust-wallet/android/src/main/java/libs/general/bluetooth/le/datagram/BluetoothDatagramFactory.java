package libs.general.bluetooth.le.datagram;

import libs.general.util.*;

import libs.general.util.ChecksumEx;

public class BluetoothDatagramFactory
{
    public static final int CHECKSUM = 0;
    public static final int STANDARD = 1;
    public static final int SLIP = 2;

    public static BluetoothDatagram createDatagram(final int protocol, final Object extra) {
        switch (protocol) {
            case 0: {
                if (!(extra instanceof ChecksumEx)) {
                    throw new IllegalArgumentException("extra is not instance of ChecksumEx");
                }
                return ChecksumBluetoothDatagram.newDatagram((ChecksumEx)extra);
            }
            case 1: {
                return BluetoothDatagram.newDatagram();
            }
            case 2: {
                return SLIPBluetoothDatagram.newDatagram();
            }
            default: {
                return null;
            }
        }
    }

    public static BluetoothDatagram createDatagram(final int protocol, final byte[] data, final Object extra) {
        switch (protocol) {
            case 0: {
                if (!(extra instanceof ChecksumEx)) {
                    throw new IllegalArgumentException("extra is not instance of ChecksumEx");
                }
                return ChecksumBluetoothDatagram.newDatagram((ChecksumEx)extra, data);
            }
            case 1: {
                return BluetoothDatagram.newDatagram(data);
            }
            case 2: {
                return SLIPBluetoothDatagram.newDatagram(data);
            }
            default: {
                return null;
            }
        }
    }
}
