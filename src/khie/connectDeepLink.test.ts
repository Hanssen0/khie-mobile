import { multiaddr } from "@multiformats/multiaddr";
import { describe, expect, it } from "vitest";

import { connectorEndpointFromDeepLink } from "./connectDeepLink";
import { encodePairingEndpointMobile, PairingEndpointError, PairingEndpointRoleError } from "./pairingEndpointCodec";

const address = multiaddr("/dns4/relay.example/tcp/443/wss/p2p/12D3KooWEUcGkHCFDcU5HucKpknW8iLt36UdGoxD2sGNkXQ8U8db");

describe("Khie connect deep links", () => {
  it("accepts a connector pairing endpoint in the fragment", async () => {
    const endpoint = await encodePairingEndpointMobile(
      "khie-wallet://app/connect",
      [address],
      "pairing-secret",
      "connector",
    );
    expect(endpoint).toContain("/connect#?role=connector&addresses=");
    await expect(connectorEndpointFromDeepLink(endpoint)).resolves.toBe(endpoint);
  });

  it("ignores unrelated links", async () => {
    await expect(connectorEndpointFromDeepLink("https://example.com/connect")).resolves.toBeUndefined();
    await expect(connectorEndpointFromDeepLink("khie-wallet://app/other#?role=connector")).resolves.toBeUndefined();
    await expect(connectorEndpointFromDeepLink("not a URL")).resolves.toBeUndefined();
  });

  it("rejects malformed or non-connector pairing links", async () => {
    const provider = await encodePairingEndpointMobile(
      "khie-wallet://app/connect",
      [address],
      "pairing-secret",
      "provider",
    );
    await expect(connectorEndpointFromDeepLink(provider)).rejects.toBeInstanceOf(PairingEndpointRoleError);
    await expect(connectorEndpointFromDeepLink("khie-wallet://app/connect#?role=connector&addresses=bad&secret=x")).rejects.toBeInstanceOf(PairingEndpointError);
    await expect(connectorEndpointFromDeepLink("khie-wallet://app/connect?secret=x#?role=connector")).rejects.toBeInstanceOf(PairingEndpointError);
  });
});
