import {
  requireOptionalNativeModule,
} from "expo";
import { Platform } from "react-native";

type KhieBackgroundEvents = {
  onStopPairing: () => void;
};

type EventSubscription = {
  remove(): void;
};

type KhieBackgroundNativeModule = {
  start(
    title: string,
    body: string,
    channelName: string,
    stopPairingLabel: string | null,
  ): Promise<void>;
  stop(): Promise<void>;
  addListener?(
    eventName: keyof KhieBackgroundEvents,
    listener: KhieBackgroundEvents[keyof KhieBackgroundEvents],
  ): EventSubscription;
};

const nativeModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule<KhieBackgroundNativeModule>(
        "KhieBackgroundService",
      )
    : null;

export async function startKhieBackgroundService(
  title: string,
  body: string,
  channelName: string,
  stopPairingLabel?: string,
): Promise<void> {
  await nativeModule?.start(
    title,
    body,
    channelName,
    stopPairingLabel ?? null,
  );
}

export async function stopKhieBackgroundService(): Promise<void> {
  await nativeModule?.stop();
}

export function addKhieBackgroundStopPairingListener(
  listener: () => void,
): EventSubscription {
  return nativeModule?.addListener?.("onStopPairing", listener) ?? {
    remove: () => undefined,
  };
}
