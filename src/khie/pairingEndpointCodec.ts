import { Buffer } from "@craftzdog/react-native-buffer";
import { multiaddr, type Multiaddr } from "@multiformats/multiaddr";
import { Unzlib, Zlib } from "fflate";
import * as lp from "it-length-prefixed";

export const MAX_DECOMPRESSED_ADDRESSES_LENGTH = 16 * 1024;
export const MAX_PAIRING_ADDRESSES = 16;
const PARAMETER_NAMES = ["addresses", "role", "secret"] as const;

export type PairingTarget = { addresses: Multiaddr[]; secret: string };

export class PairingEndpointError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PairingEndpointError";
  }
}

export class PairingEndpointRoleError extends PairingEndpointError {
  constructor(
    readonly expectedRole: string,
    readonly actualRole: string | undefined,
  ) {
    super(
      `Expected a ${expectedRole} pairing endpoint, received ${
        actualRole ? `role "${actualRole}"` : "an endpoint without a role"
      }`,
    );
    this.name = "PairingEndpointRoleError";
  }
}

export async function encodePairingEndpointMobile(
  endpointUrl: string,
  addresses: readonly Multiaddr[],
  secret: string,
  role?: string,
): Promise<string> {
  if (addresses.length === 0) {
    throw new PairingEndpointError("Pairing endpoint requires at least one address");
  }
  if (addresses.length > MAX_PAIRING_ADDRESSES) {
    throw new PairingEndpointError(
      `Pairing endpoint supports at most ${MAX_PAIRING_ADDRESSES} addresses`,
    );
  }
  const bytes = encodeAddresses(addresses);
  if (bytes.byteLength > MAX_DECOMPRESSED_ADDRESSES_LENGTH) {
    throw new PairingEndpointError("Pairing endpoint address data is too large");
  }

  const url = new URL(endpointUrl);
  const { params, route } = fragmentParameters(url);
  PARAMETER_NAMES.forEach((name) => params.delete(name));
  if (role) {
    params.set("role", role);
  }
  params.set("addresses", encodeBase64Url(zlibIncremental(bytes)));
  params.set("secret", secret);
  url.hash = `${route}?${params.toString()}`;
  return url.toString();
}

export async function decodePairingEndpointMobile(
  endpoint: string,
  expectedRole?: string,
): Promise<PairingTarget> {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch (cause) {
    throw new PairingEndpointError("Pairing endpoint is not a valid URL", { cause });
  }
  const { params } = fragmentParameters(url);
  if (expectedRole) {
    const actualRole = params.get("role")?.trim() || undefined;
    if (actualRole !== expectedRole) {
      throw new PairingEndpointRoleError(expectedRole, actualRole);
    }
  }
  const compressed = params.get("addresses")?.trim();
  const secret = params.get("secret")?.trim();
  if (!compressed || !secret) {
    throw new PairingEndpointError("Pairing endpoint is incomplete");
  }

  try {
    const bytes = unzlibIncremental(decodeBase64Url(compressed));
    const addresses: Multiaddr[] = [];
    for (const address of lp.decode([bytes], {
      maxDataLength: MAX_DECOMPRESSED_ADDRESSES_LENGTH,
    })) {
      if (addresses.length >= MAX_PAIRING_ADDRESSES) {
        throw new Error("Too many addresses");
      }
      addresses.push(multiaddr(address.subarray()));
    }
    if (addresses.length === 0) {
      throw new Error("Missing addresses");
    }
    return { addresses, secret };
  } catch (cause) {
    if (cause instanceof PairingEndpointError) {
      throw cause;
    }
    throw new PairingEndpointError(
      "Pairing endpoint contains invalid compressed addresses",
      { cause },
    );
  }
}

function fragmentParameters(url: URL) {
  const fragment = url.hash.slice(1);
  const separator = fragment.indexOf("?");
  return separator === -1
    ? { params: new URLSearchParams(), route: fragment }
    : {
        params: new URLSearchParams(fragment.slice(separator + 1)),
        route: fragment.slice(0, separator),
      };
}

function encodeAddresses(addresses: readonly Multiaddr[]): Uint8Array {
  const chunks = [...lp.encode(addresses.map((address) => address.bytes))];
  return concat(chunks.map((chunk) => chunk.subarray()));
}

function zlibIncremental(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  const encoder = new Zlib((chunk) => chunks.push(Uint8Array.from(chunk)));
  for (let offset = 0; offset < bytes.byteLength; offset += 1024) {
    const end = Math.min(offset + 1024, bytes.byteLength);
    encoder.push(bytes.subarray(offset, end), end === bytes.byteLength);
  }
  return concat(chunks);
}

function unzlibIncremental(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const decoder = new Unzlib((chunk) => {
    if (chunk.byteLength > MAX_DECOMPRESSED_ADDRESSES_LENGTH - length) {
      throw new Error("Decompressed address data is too large");
    }
    length += chunk.byteLength;
    chunks.push(Uint8Array.from(chunk));
  });
  for (let offset = 0; offset < bytes.byteLength; offset += 1024) {
    const end = Math.min(offset + 1024, bytes.byteLength);
    decoder.push(bytes.subarray(offset, end), end === bytes.byteLength);
  }
  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Invalid base64url");
  }
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(Buffer.from(normalized + padding, "base64"));
}
