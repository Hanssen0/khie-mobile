package libs.opencard.core.util;

public class HexString
{
    protected static final String[] hexChars;

    static {
        hexChars = new String[] { "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F" };
    }

    public static String dump(final byte[] data) {
        return dump(data, 0, data.length);
    }

    public static String dump(final byte[] data, final int offset, int len) {
        if (data == null) {
            return "null";
        }
        final char[] ascii = new char[16];
        final StringBuffer out = new StringBuffer(256);
        if (offset + len > data.length) {
            len = data.length - offset;
        }
        int i = offset;
        while (i < offset + len) {
            out.append(hexify(i >>> 8 & 0xFF));
            out.append(hexify(i & 0xFF));
            out.append(":  ");
            for (int j = 0; j < 16; ++j, ++i) {
                if (i < offset + len) {
                    final int b = data[i] & 0xFF;
                    out.append(hexify(b)).append(' ');
                    ascii[j] = ((b >= 32 && b < 127) ? ((char)b) : '.');
                }
                else {
                    out.append("   ");
                    ascii[j] = ' ';
                }
            }
            out.append(' ').append(ascii).append("\n");
        }
        return out.toString();
    }

    public static String hexify(final byte[] data) {
        return hexify(data, 0, data.length);
    }

    public static String hexify(final byte[] data, final int offset, int len) {
        if (data == null) {
            return "null";
        }
        if (offset + len > data.length) {
            len = data.length - offset;
        }
        final StringBuffer out = new StringBuffer(256);
        int n = 0;
        for (int i = offset; i < len; ++i) {
            if (n > 0) {
                out.append(' ');
            }
            out.append(HexString.hexChars[data[i] >> 4 & 0xF]);
            out.append(HexString.hexChars[data[i] & 0xF]);
            if (++n == 16) {
                out.append('\n');
                n = 0;
            }
        }
        return out.toString();
    }

    public static String toHexString(final byte[] data) {
        return toHexString(data, 0, data.length);
    }

    public static String toHexString(final byte[] data, final int offset, int len) {
        if (data == null) {
            return "null";
        }
        if (offset + len > data.length) {
            len = data.length - offset;
        }
        final StringBuffer out = new StringBuffer(256);
        for (int i = offset; i < len; ++i) {
            out.append(HexString.hexChars[data[i] >> 4 & 0xF]);
            out.append(HexString.hexChars[data[i] & 0xF]);
        }
        return out.toString();
    }

    public static String hexify(final int val) {
        return String.valueOf(HexString.hexChars[(val & 0xFF & 0xF0) >>> 4]) + HexString.hexChars[val & 0xF];
    }

    public static String hexifyShort(final byte a, final byte b) {
        return hexifyShort(a & 0xFF, b & 0xFF);
    }

    public static String hexifyShort(final int val) {
        return String.valueOf(HexString.hexChars[(val & 0xFFFF & 0xF000) >>> 12]) + HexString.hexChars[(val & 0xFFF & 0xF00) >>> 8] + HexString.hexChars[(val & 0xFF & 0xF0) >>> 4] + HexString.hexChars[val & 0xF];
    }

    public static String hexifyShort(final int a, final int b) {
        return hexifyShort(((a & 0xFF) << 8) + (b & 0xFF));
    }

    public static byte[] parseHexString(final String byteString) {
        final byte[] result = new byte[byteString.length() / 2];
        for (int i = 0; i < byteString.length(); i += 2) {
            final String toParse = byteString.substring(i, i + 2);
            result[i / 2] = (byte)Integer.parseInt(toParse, 16);
        }
        return result;
    }

    public static byte[] parseLittleEndianHexString(final String byteString) {
        final byte[] result = new byte[byteString.length() / 2 + 1];
        for (int i = 0; i < byteString.length(); i += 2) {
            final String toParse = byteString.substring(i, i + 2);
            result[(byteString.length() - i) / 2] = (byte)Integer.parseInt(toParse, 16);
        }
        result[0] = 0;
        return result;
    }
}
