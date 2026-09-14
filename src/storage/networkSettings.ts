import * as SecureStore from "expo-secure-store";

import {
  DEFAULT_NETWORK_RPC_URLS,
  isRpcUrl,
  type NetworkRpcUrls,
} from "../wallet/network";

const NETWORK_RPC_URLS_KEY = "khie.network.rpc-urls.v1";

function defaults(): NetworkRpcUrls {
  return { ...DEFAULT_NETWORK_RPC_URLS };
}

function parseNetworkRpcUrls(value: string | null): NetworkRpcUrls | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as Partial<NetworkRpcUrls>;
    if (!isRpcUrl(parsed.testnet ?? "") || !isRpcUrl(parsed.mainnet ?? "")) {
      return undefined;
    }
    return {
      testnet: parsed.testnet!.trim(),
      mainnet: parsed.mainnet!.trim(),
    };
  } catch {
    return undefined;
  }
}

export class SecureStoreNetworkSettings {
  async load(): Promise<NetworkRpcUrls> {
    return (
      parseNetworkRpcUrls(await SecureStore.getItemAsync(NETWORK_RPC_URLS_KEY)) ??
      defaults()
    );
  }

  async save(urls: NetworkRpcUrls): Promise<NetworkRpcUrls> {
    const normalized = {
      testnet: urls.testnet.trim(),
      mainnet: urls.mainnet.trim(),
    };
    if (!isRpcUrl(normalized.testnet) || !isRpcUrl(normalized.mainnet)) {
      throw new Error("Invalid network RPC URL");
    }
    await SecureStore.setItemAsync(NETWORK_RPC_URLS_KEY, JSON.stringify(normalized));
    return normalized;
  }
}
