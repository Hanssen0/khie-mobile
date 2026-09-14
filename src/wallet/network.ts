import { ClientPublicMainnet, ClientPublicTestnet, type Client } from "@ckb-ccc/core";

import type { Network } from "./types";

export type NetworkRpcUrls = Record<Network, string>;

export const DEFAULT_NETWORK_RPC_URLS: NetworkRpcUrls = {
  mainnet: "wss://mainnet.ckb.dev/ws",
  testnet: "wss://testnet.ckb.dev/ws",
};

export function isRpcUrl(value: string): boolean {
  try {
    const protocol = new URL(value.trim()).protocol;
    return protocol === "https:" || protocol === "wss:";
  } catch {
    return false;
  }
}

export function clientForNetwork(
  network: Network,
  url = DEFAULT_NETWORK_RPC_URLS[network],
): Client {
  const normalizedUrl = url.trim();
  if (!isRpcUrl(normalizedUrl)) {
    throw new Error(`无效的 ${network} RPC URL`);
  }

  if (normalizedUrl === DEFAULT_NETWORK_RPC_URLS[network]) {
    return network === "mainnet"
      ? new ClientPublicMainnet()
      : new ClientPublicTestnet();
  }

  return network === "mainnet"
    ? new ClientPublicMainnet({ url: normalizedUrl, fallbacks: [] })
    : new ClientPublicTestnet({ url: normalizedUrl, fallbacks: [] });
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
