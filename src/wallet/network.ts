import { ClientPublicMainnet, ClientPublicTestnet, type Client } from "@ckb-ccc/core";

import type { Network } from "./types";

export function clientForNetwork(network: Network): Client {
  return network === "mainnet"
    ? new ClientPublicMainnet()
    : new ClientPublicTestnet();
}

export function networkFromId(networkId: string): Network {
  if (networkId === "ckb-mainnet") {
    return "mainnet";
  }
  if (networkId === "ckb-testnet") {
    return "testnet";
  }
  throw new Error(`不支持的网络：${networkId}`);
}
