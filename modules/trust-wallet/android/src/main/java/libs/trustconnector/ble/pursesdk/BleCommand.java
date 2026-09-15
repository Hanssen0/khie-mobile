package libs.trustconnector.ble.pursesdk;

public class BleCommand
{
    protected static byte[] ENCkey;
    protected static byte[] MACkey;
    protected static byte[] DECkey;
    protected static final byte[] connetCommand;
    protected static final byte[] connetCommand2;
    protected static final String connetResult = "6F0F8407A0000001510000A5049F6501FF9000";
    protected static final byte[] GET_BLE_CHECK_CODE;

    public static byte[] getRandom_Value() {
        return Utils.getRandomValue();
    }

    public static byte[] getSessionData(final byte[] SequenceCounter) {
        return Utils.addBytes(HexString.parseHexString("0101"), SequenceCounter, HexString.parseHexString("000000000000000000000000"));
    }

    public static byte[] getSessionData2(final byte[] SequenceCounter) {
        return Utils.addBytes(HexString.parseHexString("0102"), SequenceCounter, HexString.parseHexString("000000000000000000000000"));
    }

    public static byte[] getSessionData3(final byte[] SequenceCounter) {
        return Utils.addBytes(HexString.parseHexString("0181"), SequenceCounter, HexString.parseHexString("000000000000000000000000"));
    }

    public static byte[] getSessionData4(final byte[] SequenceCounter) {
        return Utils.addBytes(HexString.parseHexString("0182"), SequenceCounter, HexString.parseHexString("000000000000000000000000"));
    }

    public static byte[] getMacData(final byte[] hostAuthCrypto) {
        return Utils.addBytes(HexString.parseHexString("8482030010"), Utils.addBytes(hostAuthCrypto, hostAuthCrypto.length - 8, 8));
    }

    public static byte[] getCheckDeviceCode(final byte[] hostAuth, final byte[] res3) {
        return Utils.addBytes(HexString.parseHexString("8482030010"), Utils.addBytes(hostAuth, hostAuth.length - 8, 8), res3);
    }

    static {
        connetCommand = HexString.parseHexString("00A40400094E4B65795075727365");
        connetCommand2 = HexString.parseHexString("00A4040011A00000000005424C455002");
        GET_BLE_CHECK_CODE = HexString.parseHexString("8050000008");
    }
}
