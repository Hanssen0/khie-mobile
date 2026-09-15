package libs.trustconnector.ble.pursesdk;

import android.bluetooth.BluetoothDevice;
import android.content.Context;
import expo.modules.trustwallet.TrustDes;
import libs.general.bluetooth.le.BluetoothDeviceWrapper;
import libs.general.bluetooth.le.GattError;
import libs.general.bluetooth.le.RfcommGatt;
import java.io.IOException;
import java.security.GeneralSecurityException;

public class BlePurseSDK {
    private static final String TAG = "BlePurseSDK";
    private static RfcommGatt gatt;
    private static int time = 25000;
    private static byte[] response;
    private static String errMsg = "";
    private static byte[] res3;
    private static byte[] encKey;
    private static byte[] skCMAC;
    private static boolean isConnetSucess = false;
    private static byte[] randomValue;
    private static byte[] icv;
    private static byte[] skDec;
    private static byte[] skEnc;
    public static final int CONNECT_TIME_OUT = -1;
    public static final int CONNECT_FAILED = -2;
    public static final int PIN_ERROR = -3;
    public static final int PUK_ERROR = -4;

    public BlePurseSDK() {
    }

    public static void initKey(String enckey, String macKey, String decKey) {
        BleCommand.ENCkey = HexString.parseHexString(enckey);
        BleCommand.MACkey = HexString.parseHexString(macKey);
        BleCommand.DECkey = HexString.parseHexString(decKey);
    }

    public static boolean connectPeripheral(Context context, BluetoothDevice device) {
        if (BleCommand.MACkey != null && BleCommand.ENCkey != null && BleCommand.DECkey != null) {
            isConnetSucess = false;
            gatt = (new BluetoothDeviceWrapper(device)).createRfcommGatt(context);
            gatt.setRecvTimeout(time);
            RfcommGatt.CONNECTION_PARAM_UPDATE_REQ_DELAY = 500;

            try {
                int retCode = gatt.connect(time);
                if (retCode == 0) {
                    response = gatt.transmit(BleCommand.connetCommand, time);
                    String result = HexString.toHexString(response);
                    if (result.equals("9000")) {
                        randomValue = BleCommand.getRandom_Value();
                        response = gatt.transmit(Utils.addBytes(BleCommand.GET_BLE_CHECK_CODE, randomValue), 30000);
                        if (response.length >= 28) {
                            return checkBle(gatt, response);
                        }

                        if (HexString.toHexString(response).equals("100000")) {
                            errMsg = "Bluetooth wallet connection timed out";
                        } else {
                            errMsg = "Unable to parse the wallet response";
                        }

                        isConnetSucess = false;
                    } else {
                        errMsg = "Unable to select the Bluetooth wallet";
                        isConnetSucess = false;
                    }
                } else {
                    gatt.close(time);
                    isConnetSucess = false;
                    if (retCode == 100000) {
                        errMsg = "Bluetooth wallet connection timed out";
                    } else {
                        errMsg = "Unable to connect to the Bluetooth wallet";
                        LogUtils.e("ble", "connect failed, retCode=" + retCode);
                    }
                }

                return isConnetSucess;
            } catch (InterruptedException var4) {
                var4.printStackTrace();
            } catch (IllegalArgumentException var5) {
                var5.printStackTrace();
            } catch (IOException var6) {
                var6.printStackTrace();
            } catch (Exception var7) {
                var7.printStackTrace();
            }

            return isConnetSucess;
        } else {
            errMsg = "Initialize the transport keys first";
            return false;
        }
    }

    private static boolean checkBle(RfcommGatt gatt, byte[] checkCode) throws Exception {
        byte[] KeyDiversificationData = Utils.addBytes(response, 0, 10);
        byte[] KeyVer = Utils.addBytes(response, 10, 1);
        byte[] SCPI = Utils.addBytes(response, 11, 1);
        byte[] SequenceCounter = Utils.addBytes(response, 12, 2);
        byte[] CardChallenge = Utils.addBytes(response, 14, 6);
        byte[] CardCryptogram = Utils.addBytes(response, 20, 8);
        skCMAC = TrustDes.doCrypto(BleCommand.getSessionData(SequenceCounter), BleCommand.MACkey, 289);
        byte[] skRMAC = TrustDes.doCrypto(BleCommand.getSessionData2(SequenceCounter), BleCommand.MACkey, 289);
        skDec = TrustDes.doCrypto(BleCommand.getSessionData3(SequenceCounter), BleCommand.DECkey, 289);
        skEnc = TrustDes.doCrypto(BleCommand.getSessionData4(SequenceCounter), BleCommand.ENCkey, 289);
        byte[] card_auth_crypoto_org = Utils.addBytes(randomValue, SequenceCounter, CardChallenge);
        byte[] result = TrustDes.doCrypto(card_auth_crypoto_org, skEnc, 801);
        if (HexString.toHexString(Utils.addBytes(result, result.length - 8, 8)).equals(HexString.toHexString(CardCryptogram))) {
            return checkDevice(SequenceCounter, CardChallenge, skCMAC, skEnc);
        } else {
            isConnetSucess = false;
            errMsg = "Bluetooth wallet response verification failed";
            return isConnetSucess;
        }
    }

    private static boolean checkDevice(byte[] sequenceCounter, byte[] cardChallenge, byte[] skCMAC, byte[] skEnc) throws Exception {
        byte[] hostAuthCrypto = TrustDes.doCrypto(Utils.addBytes(sequenceCounter, cardChallenge, randomValue), skEnc, 801);
        byte[] macData = BleCommand.getMacData(hostAuthCrypto);
        encKey = Utils.addBytes(skCMAC, 0, 8);
        byte[] decKey = Utils.addBytes(skCMAC, 8, 8);
        byte[] res1 = TrustDes.doCrypto(macData, encKey, 801);
        byte[] res2 = TrustDes.doCrypto(Utils.addBytes(res1, res1.length - 8, 8), decKey, 290);
        res3 = TrustDes.doCrypto(res2, encKey, 289);
        byte[] checkDeviceCode = BleCommand.getCheckDeviceCode(hostAuthCrypto, res3);
        response = gatt.transmit(checkDeviceCode, time);
        String result = HexString.toHexString(response);
        if (result.equals("9000")) {
            isConnetSucess = true;
            errMsg = "Device verification succeeded";
        } else {
            errMsg = "Device verification failed";
            if (result.equals("100000")) {
                errMsg = "Bluetooth wallet connection timed out";
            }

            isConnetSucess = false;
        }

        return isConnetSucess;
    }

    private static byte[] commandEnc(byte[] command) throws GeneralSecurityException {
        command[0] = 4;
        command[command.length - 1] = 8;
        icv = TrustDes.doCrypto(res3, encKey, 289);
        res3 = TrustDes.calcMAC(command, 8, skCMAC, icv, 13089);
        return Utils.addBytes(command, res3);
    }

    private static byte[] commandEnc(byte[] command, byte[] data) {
        command[0] = 4;
        byte[] pin = TrustDes.doCrypto(data, skEnc, 801);
        byte b = (byte)(data.length + res3.length);
        command[command.length - 1] = b;
        byte[] newCommand = Utils.addBytes(command, data);
        icv = TrustDes.doCrypto(res3, encKey, 289);
        res3 = TrustDes.calcMAC(newCommand, 8, skCMAC, icv, 13089);
        byte b2 = (byte)(pin.length + icv.length);
        command[command.length - 1] = b2;
        return Utils.addBytes(Utils.addBytes(command, pin), res3);
    }

    public static byte[] getId() {
        try {
            errMsg = "";
            if (!isConnetSucess || gatt == null) {
                errMsg = "Bluetooth wallet is not verified";
                return null;
            }

            byte[] command = HexString.parseHexString("00B5000006");
            byte[] commandEnc = commandEnc(command);
            byte[] response = gatt.transmit(commandEnc, time);
            LogUtils.e("BlePurseSDK", "Encrypted ID: " + HexString.toHexString(response));
            byte[] bytes = TrustDes.doCrypto(Utils.addBytes(response, 0, response.length - 2), skDec, 274);
            LogUtils.e("BlePurseSDK", "skDec: " + HexString.toHexString(skDec));
            if (bytes.length == 8) {
                bytes = Utils.addBytes(bytes, 0, 6);
                LogUtils.e("BlePurseSDK", "Decrypted ID: " + HexString.toHexString(bytes));
                return bytes;
            }
        } catch (InterruptedException var4) {
            var4.printStackTrace();
        } catch (GeneralSecurityException var5) {
            var5.printStackTrace();
        } catch (GattError var6) {
            var6.printStackTrace();
        }

        return null;
    }

    public static int verifyPIN(byte[] pin) {
        try {
            errMsg = "";
            if (isConnetSucess && gatt != null) {
                if (pin.length != 8) {
                    errMsg = "PIN must contain 8 bytes";
                    return -3;
                }

                byte[] pinInstruct = HexString.parseHexString("0020000008");
                byte[] commandEnc = commandEnc(pinInstruct, pin);
                LogUtils.e("commandEnc:" + HexString.toHexString(commandEnc));
                byte[] response = gatt.transmit(commandEnc, time);
                String result = HexString.toHexString(response);
                LogUtils.e("BlePurseSDK", result);
                if (result.equals("9000")) {
                    errMsg = "PIN verification succeeded";
                } else {
                    if (result.equals("100000")) {
                        errMsg = "Bluetooth wallet connection timed out";
                        return -1;
                    }

                    errMsg = "PIN verification failed";
                }

                return Integer.parseInt(result, 16);
            }

            errMsg = "Wallet is not connected";
            return -2;
        } catch (InterruptedException var5) {
            var5.printStackTrace();
        } catch (GattError var6) {
            var6.printStackTrace();
        }

        return -2;
    }

    public static int unblockPIN(byte[] puk, byte[] pin) {
        try {
            errMsg = "";
            if (isConnetSucess && gatt != null) {
                if (puk.length != 8) {
                    errMsg = "PUK must contain 8 bytes";
                    return -4;
                }

                if (pin.length != 8) {
                    errMsg = "PIN must contain 8 bytes";
                    return -3;
                }

                byte[] pinInstruct = HexString.parseHexString("002C000010");
                byte[] data = Utils.addBytes(puk, pin);
                byte[] commandEnc = commandEnc(pinInstruct, data);
                LogUtils.e("commandEnc:" + HexString.toHexString(commandEnc));
                byte[] response = gatt.transmit(commandEnc, time);
                String result = HexString.toHexString(response);
                LogUtils.e("BlePurseSDK", result);
                if (result.equals("9000")) {
                    errMsg = "PIN reset succeeded";
                } else {
                    if (result.equals("100000")) {
                        errMsg = "Bluetooth wallet connection timed out";
                        return -1;
                    }

                    errMsg = "PIN reset failed";
                }

                return Integer.parseInt(result, 16);
            }

            errMsg = "Wallet is not connected";
            return -2;
        } catch (InterruptedException var7) {
            var7.printStackTrace();
        } catch (GattError var8) {
            var8.printStackTrace();
        }

        return -2;
    }

    public static int changePIN(byte[] pin) {
        try {
            errMsg = "";
            if (isConnetSucess && gatt != null) {
                if (pin.length != 8) {
                    errMsg = "PIN must contain 8 bytes";
                    return -3;
                }

                byte[] pinInstruct = HexString.parseHexString("0024000008");
                byte[] commandEnc = commandEnc(pinInstruct, pin);
                byte[] response = gatt.transmit(commandEnc, time);
                String result = HexString.toHexString(response);
                LogUtils.e("BlePurseSDK", result);
                if (result.equals("9000")) {
                    errMsg = "PIN change succeeded";
                } else {
                    if (result.equals("100000")) {
                        errMsg = "Bluetooth wallet connection timed out";
                        return -1;
                    }

                    errMsg = "PIN change failed";
                }

                return Integer.parseInt(result, 16);
            }

            errMsg = "Bluetooth wallet is not connected";
            return -2;
        } catch (InterruptedException var5) {
            var5.printStackTrace();
        } catch (GattError var6) {
            var6.printStackTrace();
        }

        return -2;
    }

    public static int generateKey() {
        try {
            errMsg = "";
            if (isConnetSucess && gatt != null) {
                byte[] priKeyInstruct = HexString.parseHexString("00A3000000");
                byte[] commandEnc = commandEnc(priKeyInstruct);
                byte[] response = gatt.transmit(commandEnc, time);
                String result = HexString.toHexString(response);
                LogUtils.e("BlePurseSDK", result);
                if (result.equals("9000")) {
                    errMsg = "Key generation succeeded";
                } else {
                    if (result.equals("100000")) {
                        errMsg = "Bluetooth wallet connection timed out";
                        return -1;
                    }

                    errMsg = "Key generation failed";
                }

                return Integer.parseInt(result, 16);
            }

            errMsg = "Bluetooth wallet is not connected";
            return -2;
        } catch (InterruptedException var4) {
            var4.printStackTrace();
        } catch (GeneralSecurityException var5) {
            var5.printStackTrace();
        } catch (GattError var6) {
            var6.printStackTrace();
        }

        return -2;
    }

    public static int resetKey() {
        try {
            errMsg = "";
            if (isConnetSucess && gatt != null) {
                byte[] resetKey = HexString.parseHexString("00A7000000");
                byte[] commandEnc = commandEnc(resetKey);
                byte[] response = gatt.transmit(commandEnc, time);
                String result = HexString.toHexString(response);
                LogUtils.e("BlePurseSDK", result);
                if (result.equals("9000")) {
                    errMsg = "Key reset succeeded";
                } else {
                    if (result.equals("100000")) {
                        errMsg = "Bluetooth wallet connection timed out";
                        return -1;
                    }

                    errMsg = "Key reset failed";
                }

                return Integer.parseInt(result, 16);
            }

            errMsg = "Bluetooth wallet is not connected";
            return -2;
        } catch (InterruptedException var4) {
            var4.printStackTrace();
        } catch (GeneralSecurityException var5) {
            var5.printStackTrace();
        } catch (GattError var6) {
            var6.printStackTrace();
        }

        return -2;
    }

    public static int importKey(byte[] privateKey, byte[] publicKey) {
        try {
            errMsg = "";
            if (isConnetSucess && gatt != null) {
                byte[] resetKeyInstruct = HexString.parseHexString("00A9000080");
                byte[] seretKey;
                if (publicKey != null) {
                    seretKey = Utils.addBytes(privateKey, publicKey);
                } else {
                    seretKey = privateKey;
                }

                byte[] commandEnc = commandEnc(resetKeyInstruct, seretKey);
                LogUtils.e("BlePurseSDK", "commandEnc:" + HexString.toHexString(commandEnc));
                byte[] response = gatt.transmit(commandEnc, time);
                String result = HexString.toHexString(response);
                LogUtils.e("BlePurseSDK", result);
                if (result.equals("9000")) {
                    errMsg = "Key import succeeded";
                } else {
                    if (result.equals("100000")) {
                        errMsg = "Bluetooth wallet connection timed out";
                        return -1;
                    }

                    errMsg = "Key import failed";
                }

                return Integer.parseInt(result, 16);
            }

            errMsg = "Bluetooth wallet is not connected";
            return -2;
        } catch (InterruptedException var7) {
            var7.printStackTrace();
        } catch (GattError var8) {
            var8.printStackTrace();
        }

        return -2;
    }

    public static byte[] getPublicKey() {
        try {
            errMsg = "";
            if (!isConnetSucess || gatt == null) {
                errMsg = "Bluetooth wallet is not connected";
                return null;
            }

            byte[] publicKeyInstruct = HexString.parseHexString("00A5000040");
            byte[] commandEnc = commandEnc(publicKeyInstruct);
            byte[] response = gatt.transmit(commandEnc, time);
            String result = HexString.toHexString(response);
            LogUtils.e("BlePurseSDK", "Encrypted public key: " + result);
            if (result.length() > 4) {
                byte[] bytes = TrustDes.doCrypto(Utils.addBytes(response, 0, response.length - 2), skDec, 274);
                result = HexString.toHexString(bytes);
                LogUtils.e("BlePurseSDK", "skDec: " + HexString.toHexString(skDec));
                LogUtils.e("BlePurseSDK", "Decrypted public key: " + result);
                errMsg = "Public key retrieval succeeded";
                return bytes;
            }

            errMsg = "Public key was not returned (device status " + result + ")";
        } catch (InterruptedException var5) {
            var5.printStackTrace();
        } catch (GeneralSecurityException var6) {
            var6.printStackTrace();
        } catch (GattError var7) {
            var7.printStackTrace();
        }

        return null;
    }

    public static byte[] sign(byte[] hash) {
        try {
            errMsg = "";
            if (isConnetSucess && gatt != null) {
                byte[] signInstruct = HexString.parseHexString("00D5000040");
                byte[] commandEnc = commandEnc(signInstruct, hash);
                byte[] response = gatt.transmit(commandEnc, time);
                String result = HexString.toHexString(response);
                LogUtils.e("BlePurseSDK", "Encrypted signature: " + result);
                if (result.length() > 4) {
                    byte[] bytes = TrustDes.doCrypto(Utils.addBytes(response, 0, response.length - 2), skDec, 274);
                    result = HexString.toHexString(bytes);
                    LogUtils.e("BlePurseSDK", "skDec: " + HexString.toHexString(skDec));
                    LogUtils.e("BlePurseSDK", "Decrypted signature: " + result);
                    errMsg = "Signing succeeded";
                    return bytes;
                }

                errMsg = "Signing failed";
                return null;
            }

            errMsg = "Bluetooth wallet is not verified";
            return null;
        } catch (InterruptedException var6) {
            var6.printStackTrace();
        } catch (GattError var7) {
            var7.printStackTrace();
        }

        return null;
    }

    public static int closeBlePurse() {
        try {
            errMsg = "";
            if (isConnetSucess && gatt != null) {
                int retCode = gatt.close(time);
                if (retCode == 0) {
                    errMsg = "Bluetooth wallet disconnected";
                    isConnetSucess = false;
                    return retCode;
                } else {
                    errMsg = "Unable to disconnect the Bluetooth wallet";
                    LogUtils.e("ble", "disconnect failed, retCode=" + retCode);
                    Thread.sleep(5000L);
                    return retCode;
                }
            } else {
                errMsg = "Bluetooth wallet is not connected";
                return 0;
            }
        } catch (InterruptedException var1) {
            var1.printStackTrace();
            return -2;
        }
    }

    public static String getErrMsg() {
        return errMsg;
    }

    public static void setDefaultTime(int timeout) {
        time = timeout;
    }
}
