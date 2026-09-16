import { LocalizedError } from "../errors";

export const MIN_WALLET_PASSWORD_LENGTH = 8;

export function assertWalletPassword(password: string): string {
  if ([...password].length < MIN_WALLET_PASSWORD_LENGTH) {
    throw new LocalizedError(
      "walletPasswordTooShort",
      "Password must contain at least 8 characters",
    );
  }
  return password;
}
