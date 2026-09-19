import { decodePairingEndpointMobile, PairingEndpointError } from "./pairingEndpointCodec";

export async function connectorEndpointFromDeepLink(value: string): Promise<string | undefined> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "khie-wallet:" ||
    url.hostname !== "app" ||
    url.pathname !== "/connect"
  ) {
    return undefined;
  }
  if (url.username || url.password || url.port || url.search || !url.hash.startsWith("#?")) {
    throw new PairingEndpointError("Invalid Khie connect deep link");
  }

  await decodePairingEndpointMobile(url.toString(), "connector");
  return url.toString();
}
