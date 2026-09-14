import { RTCPeerConnection } from "react-native-webrtc";

import { khieTrace } from "./khieTrace";

type DiagnosticPeerConnection = {
  _pcId?: number;
  connectionState: string;
  iceConnectionState: string;
  iceGatheringState: string;
  signalingState: string;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
};

type DiagnosticDataChannel = {
  _reactTag?: string;
  id: number | null;
  label: string;
  ordered: boolean;
  readyState: string;
  onmessage?: ((event: unknown) => void) | null;
  addEventListener: (type: string, listener: (event: any) => void) => void;
  send: (data: string | ArrayBuffer | ArrayBufferView) => void;
};

type AnyFunction = (...args: any[]) => any;

const diagnosticsInstalled = Symbol.for("khie.webrtcDiagnostics.installed");
const observedPeerConnections = new WeakSet<object>();
const observedDataChannels = new WeakSet<object>();

function byteLength(data: unknown): number | undefined {
  if (typeof data === "string") return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return undefined;
}

function channelDetails(channel: DiagnosticDataChannel): Record<string, unknown> {
  return {
    channelId: channel.id,
    label: channel.label,
    ordered: channel.ordered,
    readyState: channel.readyState,
    hasOnMessage: typeof channel.onmessage === "function",
    reactTag: channel._reactTag,
  };
}

function observeDataChannel(
  channel: DiagnosticDataChannel,
  pcId: number | undefined,
  source: "local" | "remote",
): void {
  if (observedDataChannels.has(channel)) return;
  observedDataChannels.add(channel);

  const details = () => ({ pcId, source, ...channelDetails(channel) });
  khieTrace("webrtc.channel.observe", details());
  channel.addEventListener("open", () => khieTrace("webrtc.channel.open", details()));
  channel.addEventListener("closing", () => khieTrace("webrtc.channel.closing", details()));
  channel.addEventListener("close", () => khieTrace("webrtc.channel.close", details()));
  channel.addEventListener("error", (event) =>
    khieTrace("webrtc.channel.error", { ...details(), error: String(event) }),
  );
  channel.addEventListener("message", (event) =>
    khieTrace("webrtc.channel.message", {
      ...details(),
      bytes: byteLength(event.data),
      dataType: Object.prototype.toString.call(event.data),
    }),
  );

  const originalSend = channel.send.bind(channel);
  channel.send = (data: string | ArrayBuffer | ArrayBufferView) => {
    khieTrace("webrtc.channel.send", { ...details(), bytes: byteLength(data) });
    return originalSend(data);
  };
}

function observePeerConnection(connection: DiagnosticPeerConnection): void {
  if (observedPeerConnections.has(connection)) return;
  observedPeerConnections.add(connection);

  const details = () => ({
    pcId: connection._pcId,
    connectionState: connection.connectionState,
    iceConnectionState: connection.iceConnectionState,
    iceGatheringState: connection.iceGatheringState,
    signalingState: connection.signalingState,
  });
  khieTrace("webrtc.pc.observe", details());
  connection.addEventListener("connectionstatechange", () =>
    khieTrace("webrtc.pc.connectionstatechange", details()),
  );
  connection.addEventListener("iceconnectionstatechange", () =>
    khieTrace("webrtc.pc.iceconnectionstatechange", details()),
  );
  connection.addEventListener("icegatheringstatechange", () =>
    khieTrace("webrtc.pc.icegatheringstatechange", details()),
  );
  connection.addEventListener("signalingstatechange", () =>
    khieTrace("webrtc.pc.signalingstatechange", details()),
  );
  connection.addEventListener("datachannel", (event: any) => {
    const channel = event.channel as DiagnosticDataChannel;
    khieTrace("webrtc.pc.datachannel", { ...details(), ...channelDetails(channel) });
    observeDataChannel(channel, connection._pcId, "remote");
  });
}

export function installWebRtcDiagnostics(): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;

  const prototype = RTCPeerConnection.prototype as unknown as Record<PropertyKey, any>;
  if (prototype[diagnosticsInstalled] === true) return;
  prototype[diagnosticsInstalled] = true;

  const originalCreateOffer = prototype.createOffer!;
  prototype.createOffer = async function (this: DiagnosticPeerConnection, ...args: any[]) {
    observePeerConnection(this);
    return originalCreateOffer.apply(this, args);
  };

  const originalCreateAnswer = prototype.createAnswer!;
  prototype.createAnswer = async function (this: DiagnosticPeerConnection, ...args: any[]) {
    observePeerConnection(this);
    return originalCreateAnswer.apply(this, args);
  };

  const originalSetRemoteDescription = prototype.setRemoteDescription!;
  prototype.setRemoteDescription = async function (this: DiagnosticPeerConnection, ...args: any[]) {
    observePeerConnection(this);
    return originalSetRemoteDescription.apply(this, args);
  };

  const originalCreateDataChannel = prototype.createDataChannel!;
  prototype.createDataChannel = function (this: DiagnosticPeerConnection, ...args: any[]) {
    observePeerConnection(this);
    const channel = originalCreateDataChannel.apply(this, args) as DiagnosticDataChannel;
    observeDataChannel(channel, this._pcId, "local");
    return channel;
  };

  khieTrace("webrtc.diagnostics.installed");
}
