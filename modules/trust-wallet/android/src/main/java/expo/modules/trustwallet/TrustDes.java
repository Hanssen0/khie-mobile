package expo.modules.trustwallet;

import java.security.GeneralSecurityException;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Minimal implementation of the DES modes used by the original Trust connector. */
public final class TrustDes {
  private static final byte[] ZERO_IV = new byte[8];

  private TrustDes() {}

  public static byte[] doCrypto(byte[] source, byte[] key, int mode) {
    try {
      boolean encrypt = (mode & 0x0f) == 1;
      boolean cbc = (mode & 0xf0) == 0x20;
      int padding = mode & 0xf00;
      byte[] input = encrypt ? pad(source, padding) : source.clone();
      if (input.length == 0 || input.length % 8 != 0) {
        throw new GeneralSecurityException("Invalid DES block length");
      }

      boolean triple = key.length != 8;
      byte[] normalizedKey = triple ? tripleDesKey(key) : key;
      String algorithm = triple ? "DESede" : "DES";
      String transformation = algorithm + (cbc ? "/CBC/NoPadding" : "/ECB/NoPadding");
      Cipher cipher = Cipher.getInstance(transformation);
      SecretKeySpec keySpec = new SecretKeySpec(normalizedKey, algorithm);
      if (cbc) {
        cipher.init(encrypt ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE, keySpec,
            new IvParameterSpec(ZERO_IV));
      } else {
        cipher.init(encrypt ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE, keySpec);
      }
      return cipher.doFinal(input);
    } catch (GeneralSecurityException cause) {
      throw new IllegalStateException("Trust DES operation failed", cause);
    }
  }

  public static byte[] calcMAC(
      byte[] source,
      int macLength,
      byte[] key,
      byte[] iv,
      int mode
  ) {
    try {
      if ((mode & 0xf000) != 0x3000 || key.length < 16) {
        throw new GeneralSecurityException("Unsupported Trust MAC mode");
      }

      byte[] padded = pad(source, mode & 0xf00);
      Cipher cbc = Cipher.getInstance("DES/CBC/NoPadding");
      cbc.init(
          Cipher.ENCRYPT_MODE,
          new SecretKeySpec(Arrays.copyOfRange(key, 0, 8), "DES"),
          new IvParameterSpec(iv == null ? ZERO_IV : iv)
      );
      byte[] first = cbc.doFinal(padded);
      byte[] block = Arrays.copyOfRange(first, first.length - 8, first.length);

      Cipher ecb = Cipher.getInstance("DES/ECB/NoPadding");
      ecb.init(Cipher.DECRYPT_MODE, new SecretKeySpec(Arrays.copyOfRange(key, 8, 16), "DES"));
      block = ecb.doFinal(block);
      ecb.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(Arrays.copyOfRange(key, 0, 8), "DES"));
      return Arrays.copyOf(ecb.doFinal(block), macLength);
    } catch (GeneralSecurityException cause) {
      throw new IllegalStateException("Trust MAC operation failed", cause);
    }
  }

  private static byte[] pad(byte[] source, int mode) throws GeneralSecurityException {
    if (mode == 0x100) {
      if (source.length == 0 || source.length % 8 != 0) {
        throw new GeneralSecurityException("Trust data is not block aligned");
      }
      return source.clone();
    }
    if (mode != 0x300) {
      throw new GeneralSecurityException("Unsupported Trust padding mode");
    }
    int paddingLength = 8 - source.length % 8;
    byte[] result = Arrays.copyOf(source, source.length + paddingLength);
    result[source.length] = (byte) 0x80;
    return result;
  }

  private static byte[] tripleDesKey(byte[] key) throws GeneralSecurityException {
    if (key.length == 24) {
      return key;
    }
    if (key.length != 16) {
      throw new GeneralSecurityException("Trust DES key must contain 8, 16, or 24 bytes");
    }
    byte[] result = new byte[24];
    System.arraycopy(key, 0, result, 0, 16);
    System.arraycopy(key, 0, result, 16, 8);
    return result;
  }
}
