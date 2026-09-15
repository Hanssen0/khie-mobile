declare module "react-native-quick-crypto/lib/module/scrypt" {
  import type { BinaryLike } from "react-native-quick-crypto";

  type ScryptOptions = {
    N?: number;
    r?: number;
    p?: number;
    cost?: number;
    blockSize?: number;
    parallelization?: number;
    maxmem?: number;
  };

  type ScryptResult = Uint8Array & { fill(value: number): unknown };

  export function scrypt(
    password: BinaryLike,
    salt: BinaryLike,
    keylen: number,
    options: ScryptOptions,
    callback: (error: Error | null, derivedKey?: ScryptResult) => void,
  ): void;
}
