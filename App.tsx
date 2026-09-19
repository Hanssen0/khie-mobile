import {
  type JsonRpcPayload,
  type Signer,
  SignerJsonRpcProviderSession,
  type SignerJsonRpcProviderSessionConfig,
} from "@ckb-ccc/core";
import {
  addKhieBackgroundStopPairingListener,
  startKhieBackgroundService,
  stopKhieBackgroundService,
} from "@khie/background-service";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { NavigationBar } from "expo-navigation-bar";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState,
  Linking,
  Platform,
  useColorScheme,
} from "react-native";
import {
  Button as PaperButton,
  Dialog,
  HelperText,
  PaperProvider,
  Portal,
  Text,
} from "react-native-paper";
import {
  KeyboardAvoidingView,
  KeyboardController,
  KeyboardProvider,
} from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LocalizedError } from "./src/errors";
import {
  I18nProvider,
  useI18n,
} from "./src/i18n";
import { ApprovalQueue, type ApprovalItem } from "./src/khie/approvalQueue";
import { resumeKhieSessionWhenActive } from "./src/khie/appLifecycle";
import {
  finishKhieHeadlessTask,
  setKhieKeepAliveHandler,
} from "./src/khie/backgroundKeepAlive";
import {
  addKhieNotificationResponseListener,
  configureKhieNotifications,
  dismissKhieConnectionNotification,
  dismissKhieRequestNotification,
  getKhieNotificationPermission,
  requestKhieNotificationPermission,
  showKhieConnectionNotification,
  showKhieRequestNotification,
  type KhieNotificationPermission,
} from "./src/khie/notifications";
import {
  KhieProviderSession,
  type KhieProviderSessionState,
} from "./src/khie/KhieProviderSession";
import { DEFAULT_KHIE_RELAY_ADDRESS } from "./src/khie/protocol";
import {
  connectTrustWallet,
  disconnectTrustWallet,
  ensureTrustBluetoothReady,
  generateTrustWalletKey,
  importTrustWalletKey,
  resetTrustWalletKey,
  resetTrustWalletPin,
  type ConnectedTrustDevice,
  type TrustDevice,
} from "./src/trust/native";
import {
  SecureStoreNetworkSettings,
} from "./src/storage/networkSettings";
import {
  SecureStoreThemeSettings,
  type ThemePreference,
} from "./src/storage/themeSettings";
import {
  defaultUpdateSettings,
  SecureStoreUpdateSettings,
  shouldAutomaticallyCheckForUpdates,
  type UpdateSettings,
} from "./src/storage/updateSettings";
import {
  SecureStoreWalletVault,
  type WalletCredential,
  type WalletAuthenticationPurpose,
} from "./src/storage/walletVault";
import { LocalMnemonicSigningBackend } from "./src/wallet/localMnemonicBackend";
import { KhieSignerAdapter } from "./src/wallet/khieSignerAdapter";
import { TrustHardwareSigningBackend, type RequestTrustPin } from "./src/wallet/trustHardwareBackend";
import {
  DEFAULT_NETWORK_RPC_URLS,
  clientForNetwork,
  networkFromId,
  type NetworkRpcUrls,
} from "./src/wallet/network";
import {
  normalizeTrustPublicKey,
  prepareTrustKeyImport,
} from "./src/wallet/trustSignature";
import { assertWalletPassword } from "./src/wallet/password";
import type { Network, WalletState } from "./src/wallet/types";
import { walletDarkTheme, walletLightTheme } from "./src/theme";
import {
  fetchLatestRelease,
  GITHUB_RELEASES_URL,
  isRetryableUpdateError,
  isVersionNewer,
  selectAndroidApk,
} from "./src/update/githubRelease";
import {
  AppDialogProvider,
  errorMessage,
  KeyboardDialogContent,
  Notice,
  TrustBluetoothSetupProvider,
  useAppDialog,
  useTrustBluetoothSetup,
  walletAuthenticationPrompt,
  WalletTextInput,
} from "./src/ui/components";
import { approvalNetwork, approvalTitle } from "./src/ui/KhieScreen";
import { hasTrustPublicKeyChanged } from "./src/ui/navigation";
import { WalletRouter } from "./src/ui/WalletRouter";
import { styles } from "./src/ui/styles";

type Screen = "home" | "receive" | "send" | "khie" | "trust" | "settings" | "scanner";
type Onboarding = "start" | "create" | "confirm" | "password" | "restore" | "trust";
type WalletUnlockResult = {
  mnemonic?: string;
  credential: WalletCredential;
};
type WalletPasswordRequest = {
  active: () => boolean;
  purpose: WalletAuthenticationPurpose;
  reject: (cause: Error) => void;
  resolve: (result: WalletUnlockResult) => void;
  signal?: AbortSignal;
  walletId?: string;
};
type TrustPinRequest = {
  active: () => boolean;
  purpose: "connect" | "message" | "transaction" | "keyManagement";
  deviceId?: string;
  reject: (cause: Error) => void;
  resolve: (pin: string) => void;
  signal?: AbortSignal;
};
const endpointUrl = "https://app.ckbccc.com/khie";
const currentAppVersion =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "unknown";
const configuredBuildCommit = Constants.expoConfig?.extra?.buildCommit;
const currentBuildCommit =
  typeof configuredBuildCommit === "string" ? configuredBuildCommit : "unknown";
const runtimeGlobals = globalThis as typeof globalThis & {
  HermesInternal?: unknown;
  nativeFabricUIManager?: unknown;
};
const currentAppArchitecture = [
  Device.supportedCpuArchitectures?.[0],
  runtimeGlobals.nativeFabricUIManager ? "New Architecture" : "Legacy Architecture",
  runtimeGlobals.HermesInternal ? "Hermes" : "JSC",
]
  .filter(Boolean)
  .join(" · ");

export default function App() {
  const systemColorScheme = useColorScheme();
  const themeSettings = useMemo(() => new SecureStoreThemeSettings(), []);
  const [themePreference, setThemePreference] =
    useState<ThemePreference>("system");
  const dark =
    themePreference === "system"
      ? systemColorScheme === "dark"
      : themePreference === "dark";
  const theme = dark ? walletDarkTheme : walletLightTheme;

  useEffect(() => {
    let active = true;
    void themeSettings.load().then((preference) => {
      if (active) setThemePreference(preference);
    });
    return () => {
      active = false;
    };
  }, [themeSettings]);

  const changeThemePreference = useCallback(
    async (preference: ThemePreference) => {
      setThemePreference(await themeSettings.save(preference));
    },
    [themeSettings],
  );

  return (
    <SafeAreaProvider>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <NavigationBar style={dark ? "dark" : "light"} />
        <I18nProvider>
          <PaperProvider theme={theme}>
            <AppDialogProvider>
              <TrustBluetoothSetupProvider>
                <WalletApp
                  themePreference={themePreference}
                  onChangeThemePreference={changeThemePreference}
                />
              </TrustBluetoothSetupProvider>
            </AppDialogProvider>
          </PaperProvider>
        </I18nProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function requestAbortReason(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("Request was cancelled");
  error.name = "AbortError";
  return error;
}

function WalletApp({
  themePreference,
  onChangeThemePreference,
}: {
  themePreference: ThemePreference;
  onChangeThemePreference: (preference: ThemePreference) => Promise<void>;
}) {
  const { t } = useI18n();
  const appDialog = useAppDialog();
  const { show: showTrustBluetoothSetupError } = useTrustBluetoothSetup();
  const tRef = useRef(t);
  tRef.current = t;
  const vault = useMemo(
    () =>
      new SecureStoreWalletVault((purpose) =>
        walletAuthenticationPrompt(purpose, tRef.current),
      ),
    [],
  );
  const networkSettings = useMemo(() => new SecureStoreNetworkSettings(), []);
  const updateSettingsStore = useMemo(() => new SecureStoreUpdateSettings(), []);
  const approvalQueue = useMemo(() => new ApprovalQueue(), []);
  const clients = useRef({
    mainnet: clientForNetwork("mainnet"),
    testnet: clientForNetwork("testnet"),
  });
  const signerRef = useRef<Signer | undefined>(undefined);
  const sessionRef = useRef<KhieProviderSession | undefined>(undefined);
  const providerSessionOwnerRef =
    useRef<ReturnType<typeof SignerJsonRpcProviderSession.open> | undefined>(
      undefined,
    );
  const invalidateProviderSession = useCallback(() => {
    const previous = providerSessionOwnerRef.current;
    providerSessionOwnerRef.current = undefined;
    void previous?.dispose();
  }, []);
  const networkRef = useRef<Network>("testnet");
  const previousPaired = useRef(false);
  const updateSettingsRef = useRef<UpdateSettings>(defaultUpdateSettings());
  const updateCheckInFlight = useRef(false);
  const checkForUpdatesRef = useRef<(automatic?: boolean) => Promise<void>>(
    async () => undefined,
  );

  const [loading, setLoading] = useState(true);
  const [walletState, setWalletState] = useState<WalletState>({
    biometricUnlock: false,
    masterPasswordSet: false,
    version: 5,
    wallets: [],
  });
  const [network, setNetwork] = useState<Network>("testnet");
  const [rpcUrls, setRpcUrls] = useState<NetworkRpcUrls>(DEFAULT_NETWORK_RPC_URLS);
  const [screen, setScreen] = useState<Screen>("home");
  const [appState, setAppState] = useState(AppState.currentState);
  const [onboarding, setOnboarding] = useState<Onboarding>("start");
  const [addingWallet, setAddingWallet] = useState(false);
  const [approval, setApproval] = useState<ApprovalItem>();
  const [pairing, setPairing] = useState(false);
  const [sessionState, setSessionState] = useState<KhieProviderSessionState>({
    endpoint: "",
    paired: false,
    ready: false,
    relayAddress: DEFAULT_KHIE_RELAY_ADDRESS,
    relayConnected: false,
    relayConnecting: false,
  });
  const [notice, setNotice] = useState<string>();
  const [trustDevice, setTrustDevice] = useState<ConnectedTrustDevice>();
  const [trustPinRequest, setTrustPinRequest] = useState<TrustPinRequest>();
  const [trustPin, setTrustPin] = useState("");
  const [walletPasswordRequest, setWalletPasswordRequest] =
    useState<WalletPasswordRequest>();
  const [walletPassword, setWalletPassword] = useState("");
  const [walletPasswordError, setWalletPasswordError] = useState<string>();
  const [unlockingWallet, setUnlockingWallet] = useState(false);
  const [biometricUnlocking, setBiometricUnlocking] = useState(false);
  const [trustPinResetOpen, setTrustPinResetOpen] = useState(false);
  const [trustPuk, setTrustPuk] = useState("");
  const [trustNewPin, setTrustNewPin] = useState("");
  const [trustConfirmPin, setTrustConfirmPin] = useState("");
  const [resettingTrustPin, setResettingTrustPin] = useState(false);
  const [khieNotificationPermission, setKhieNotificationPermission] =
    useState<KhieNotificationPermission>();
  const [khieNotificationsConfigured, setKhieNotificationsConfigured] =
    useState(false);
  const [khieNotificationPromptOpen, setKhieNotificationPromptOpen] =
    useState(false);
  const [updateSettings, setUpdateSettings] = useState<UpdateSettings>(
    defaultUpdateSettings,
  );
  const [updateSettingsLoaded, setUpdateSettingsLoaded] = useState(false);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [focusAppInformation, setFocusAppInformation] = useState(false);
  const khieNotificationPromptDismissed = useRef(false);
  const walletStateRef = useRef(walletState);
  walletStateRef.current = walletState;

  const requestTrustPin = useCallback<RequestTrustPin>(
    (purpose, signal) =>
      new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        let settled = false;
        const onAbort = () => {
          request.reject(requestAbortReason(signal));
          setTrustPinRequest((current) =>
            current === request ? undefined : current,
          );
          setTrustPin("");
        };
        const settle = <T,>(callback: (value: T) => void, value: T) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          callback(value);
        };
        const request: TrustPinRequest = {
          active: () => !settled,
          purpose,
          signal,
          reject: (cause) => settle(reject, cause),
          resolve: (pin) => settle(resolve, pin),
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        setTrustPin("");
        setTrustPinRequest((current) => {
          current?.reject(new Error("Cryptape Trust PIN request was cancelled"));
          return request;
        });
      }),
    [],
  );

  const submitTrustPin = useCallback(() => {
    if (!trustPinRequest || trustPin.length !== 8) return;
    if (trustPinRequest.signal?.aborted) {
      trustPinRequest.reject(requestAbortReason(trustPinRequest.signal));
      setTrustPinRequest((current) =>
        current === trustPinRequest ? undefined : current,
      );
      setTrustPin("");
      return;
    }
    trustPinRequest.resolve(trustPin);
    setTrustPinRequest((current) =>
      current === trustPinRequest ? undefined : current,
    );
    setTrustPin("");
    void KeyboardController.dismiss({ animated: true });
  }, [trustPin, trustPinRequest]);

  const requestPasswordUnlock = useCallback(
    (
      purpose: WalletAuthenticationPurpose,
      walletId?: string,
      signal?: AbortSignal,
    ) =>
      new Promise<WalletUnlockResult>((resolve, reject) => {
        signal?.throwIfAborted();
        let settled = false;
        const onAbort = () => {
          request.reject(requestAbortReason(signal));
          setWalletPasswordRequest((current) =>
            current === request ? undefined : current,
          );
          setWalletPassword("");
          setWalletPasswordError(undefined);
        };
        const settle = <T,>(callback: (value: T) => void, value: T) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          callback(value);
        };
        const request: WalletPasswordRequest = {
          active: () => !settled,
          purpose,
          signal,
          walletId,
          reject: (cause) => settle(reject, cause),
          resolve: (result) => settle(resolve, result),
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        setWalletPassword("");
        setWalletPasswordError(undefined);
        setWalletPasswordRequest((current) => {
          current?.reject(new Error("Wallet unlock was cancelled"));
          return request;
        });
      }),
    [],
  );

  const requestWalletUnlock = useCallback(
    async (
      walletId: string,
      purpose: WalletAuthenticationPurpose,
      forcePassword = false,
      signal?: AbortSignal,
    ): Promise<WalletUnlockResult> => {
      signal?.throwIfAborted();
      const wallet = walletStateRef.current.wallets.find(
        (candidate) => candidate.id === walletId,
      );
      if (!wallet || wallet.kind !== "mnemonic") {
        throw new LocalizedError("walletUnavailable", "Wallet is unavailable");
      }

      if (walletStateRef.current.biometricUnlock && !forcePassword) {
        let masterKey: string | null = null;
        let credentialRead = false;
        setBiometricUnlocking(true);
        try {
          masterKey = await vault.readBiometricMasterKey(purpose);
          signal?.throwIfAborted();
          credentialRead = true;
          if (masterKey) {
            const credential: WalletCredential = { kind: "masterKey", value: masterKey };
            const mnemonic = await vault.readMnemonic(walletId, credential);
            signal?.throwIfAborted();
            return {
              mnemonic,
              credential,
            };
          }
        } catch (cause) {
          if (signal?.aborted) throw requestAbortReason(signal);
          // Cancelling or temporarily failing system authentication falls back
          // to the wallet password without changing the biometric preference.
        } finally {
          setBiometricUnlocking(false);
        }
        if (credentialRead && !masterKey) {
          void vault
            .setBiometricUnlock()
            .then(setWalletState)
            .catch(() => undefined);
        }
      }

      signal?.throwIfAborted();
      return requestPasswordUnlock(purpose, walletId, signal);
    },
    [requestPasswordUnlock, vault],
  );

  const submitWalletPassword = useCallback(async () => {
    const request = walletPasswordRequest;
    if (!request || unlockingWallet || !walletPassword) return;
    setUnlockingWallet(true);
    setWalletPasswordError(undefined);
    try {
      const credential: WalletCredential = {
        kind: "password",
        value: walletPassword,
      };
      const mnemonic = request.walletId
        ? await vault.readMnemonic(request.walletId, credential)
        : undefined;
      if (!request.walletId && !(await vault.verifyMasterCredential(credential))) {
        throw new LocalizedError("invalidWalletPassword", "Invalid password");
      }
      request.signal?.throwIfAborted();
      if (!request.active()) return;
      request.resolve({ mnemonic, credential });
      setWalletPasswordRequest((current) =>
        current === request ? undefined : current,
      );
      setWalletPassword("");
      void KeyboardController.dismiss({ animated: true });
    } catch (cause) {
      if (request.active()) {
        setWalletPasswordError(errorMessage(cause, t));
      }
    } finally {
      setUnlockingWallet(false);
    }
  }, [t, unlockingWallet, vault, walletPassword, walletPasswordRequest]);

  const requestMasterCredential = useCallback(
    async (
      purpose: WalletAuthenticationPurpose,
      forcePassword = false,
    ): Promise<WalletCredential> => {
      const state = walletStateRef.current;
      if (state.biometricUnlock && !forcePassword) {
        let credentialRead = false;
        setBiometricUnlocking(true);
        try {
          const masterKey = await vault.readBiometricMasterKey(purpose);
          credentialRead = true;
          if (masterKey) {
            const credential: WalletCredential = { kind: "masterKey", value: masterKey };
            if (await vault.verifyMasterCredential(credential)) return credential;
          }
        } catch {
          // Let the master-password dialog handle cancellation, invalidation,
          // or a temporarily unavailable biometric prompt.
        } finally {
          setBiometricUnlocking(false);
        }
        if (credentialRead) {
          void vault.setBiometricUnlock().then(setWalletState).catch(() => undefined);
        }
      }
      return (await requestPasswordUnlock(purpose)).credential;
    },
    [requestPasswordUnlock, vault],
  );

  useEffect(
    () =>
      approvalQueue.subscribe((item) => {
        setApproval(item);
      }),
    [approvalQueue],
  );

  useEffect(() => {
    let active = true;
    setKhieNotificationsConfigured(false);
    void configureKhieNotifications({
      allow: t("allow"),
      connectionChannel: t("khieConnectionNotificationChannel"),
      deny: t("deny"),
      requestChannel: t("khieRequestNotificationChannel"),
      unpair: t("unpair"),
    })
      .then(getKhieNotificationPermission)
      .then((permission) => {
        if (!active) return;
        setKhieNotificationPermission(permission);
        setKhieNotificationsConfigured(true);
      })
      .catch(() => {
        if (!active) return;
        setKhieNotificationPermission("denied");
      });
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    const shouldExplainBackgroundConnection =
      Platform.OS === "android"
        ? screen === "khie"
        : sessionState.paired;
    if (!shouldExplainBackgroundConnection) {
      khieNotificationPromptDismissed.current = false;
      setKhieNotificationPromptOpen(false);
      return;
    }
    if (
      khieNotificationsConfigured &&
      khieNotificationPermission === "prompt" &&
      !khieNotificationPromptDismissed.current
    ) {
      setKhieNotificationPromptOpen(true);
    }
  }, [
    khieNotificationPermission,
    khieNotificationsConfigured,
    screen,
    sessionState.paired,
  ]);

  useEffect(() => {
    if (Platform.OS === "android") return;
    const khieIsVisible = appState === "active" && screen === "khie";
    if (
      !sessionState.paired ||
      !khieNotificationsConfigured ||
      khieNotificationPermission !== "granted" ||
      khieIsVisible
    ) {
      void dismissKhieConnectionNotification().catch(() => undefined);
      return;
    }
    const connection = !sessionState.remotePeer?.active
      ? t("inactive")
      : sessionState.remotePeer.direct
        ? t("direct")
        : t("relayed");
    void showKhieConnectionNotification(
      t("khieConnectedNotificationTitle"),
      t("khieConnectedNotificationBody", {
        connection,
        peer: sessionState.remotePeer?.name ?? t("unknown"),
      }),
    ).catch(() => undefined);
  }, [
    appState,
    khieNotificationPermission,
    khieNotificationsConfigured,
    screen,
    sessionState.paired,
    sessionState.remotePeer?.active,
    sessionState.remotePeer?.direct,
    sessionState.remotePeer?.name,
    t,
  ]);

  useEffect(() => {
    let resuming = false;
    setKhieKeepAliveHandler(async () => {
      if (resuming) return;
      resuming = true;
      try {
        await sessionRef.current?.resume();
      } finally {
        resuming = false;
      }
    });
    return () => setKhieKeepAliveHandler();
  }, []);

  useEffect(() => {
    const waitingForPairing =
      !sessionState.paired && (screen === "khie" || screen === "scanner");
    sessionRef.current?.setPairingEnabled(waitingForPairing);
    if (Platform.OS !== "android") return;
    if (!sessionState.paired && !waitingForPairing) {
      finishKhieHeadlessTask();
      void stopKhieBackgroundService().catch(() => undefined);
      return;
    }
    if (waitingForPairing) {
      void startKhieBackgroundService(
        t("khiePairingNotificationTitle"),
        t("khiePairingNotificationBody"),
        t("khieConnectionNotificationChannel"),
        t("stopPairing"),
      ).catch(() => undefined);
      return;
    }
    const connection = !sessionState.remotePeer?.active
      ? t("inactive")
      : sessionState.remotePeer.direct
        ? t("direct")
        : t("relayed");
    void startKhieBackgroundService(
      t("khieConnectedNotificationTitle"),
      t("khieConnectedNotificationBody", {
        connection,
        peer: sessionState.remotePeer?.name ?? t("unknown"),
      }),
      t("khieConnectionNotificationChannel"),
    ).catch(() => undefined);
  }, [
    sessionState.paired,
    sessionState.ready,
    sessionState.remotePeer?.active,
    sessionState.remotePeer?.direct,
    sessionState.remotePeer?.name,
    screen,
    t,
  ]);

  useEffect(() => {
    const subscription = addKhieBackgroundStopPairingListener(() => {
      sessionRef.current?.setPairingEnabled(false);
      setPairing(false);
      setScreen("home");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const khieIsVisible = appState === "active" && screen === "khie";
    if (
      !sessionState.paired ||
      !approval ||
      !khieNotificationsConfigured ||
      khieNotificationPermission !== "granted" ||
      khieIsVisible
    ) {
      void dismissKhieRequestNotification().catch(() => undefined);
      return;
    }
    void showKhieRequestNotification(
      approval.id,
      approvalTitle(approval.request, t),
      approvalNetwork(approval.request, network, t),
    ).catch(() => undefined);
  }, [
    approval,
    appState,
    khieNotificationPermission,
    khieNotificationsConfigured,
    network,
    screen,
    sessionState.paired,
    t,
  ]);

  useEffect(
    () =>
      addKhieNotificationResponseListener((interaction) => {
        setScreen("khie");
        if (interaction.type === "unpair") {
          void sessionRef.current?.unpair().catch(() => undefined);
          return;
        }
        if (
          interaction.type === "respond" &&
          approvalQueue.current?.id === interaction.approvalId
        ) {
          approvalQueue.respond(interaction.approvalId, interaction.approved);
        }
      }),
    [approvalQueue],
  );

  useEffect(() => {
    void Promise.all([
      vault.loadWallets(),
      networkSettings.load().catch((cause: unknown) => {
        setNotice(errorMessage(cause, tRef.current));
        return { ...DEFAULT_NETWORK_RPC_URLS };
      }),
    ])
      .then(([nextWalletState, nextRpcUrls]) => {
        clients.current = {
          mainnet: clientForNetwork("mainnet", nextRpcUrls.mainnet),
          testnet: clientForNetwork("testnet", nextRpcUrls.testnet),
        };
        setRpcUrls(nextRpcUrls);
        setWalletState(nextWalletState);
      })
      .catch((cause: unknown) => setNotice(errorMessage(cause, tRef.current)))
      .finally(() => setLoading(false));
  }, [networkSettings, vault]);

  useEffect(() => {
    let active = true;
    void updateSettingsStore
      .load()
      .then((settings) => {
        if (!active) return;
        updateSettingsRef.current = settings;
        setUpdateSettings(settings);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setUpdateSettingsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [updateSettingsStore]);

  const profile =
    walletState.wallets.find((wallet) => wallet.id === walletState.selectedWalletId) ??
    walletState.wallets[0];

  const persistUpdateSettings = useCallback(
    async (settings: UpdateSettings) => {
      updateSettingsRef.current = settings;
      setUpdateSettings(settings);
      await updateSettingsStore.save(settings);
    },
    [updateSettingsStore],
  );

  const checkForUpdates = useCallback(
    async (automatic = false) => {
      if (updateCheckInFlight.current) return;
      updateCheckInFlight.current = true;
      setCheckingForUpdates(true);
      const checkedAt = Date.now();

      if (automatic) {
        const attempted = {
          ...updateSettingsRef.current,
          lastAutomaticCheckAt: checkedAt,
        };
        updateSettingsRef.current = attempted;
        setUpdateSettings(attempted);
        await updateSettingsStore.save(attempted).catch(() => undefined);
      }

      try {
        const release = await fetchLatestRelease();
        await persistUpdateSettings({
          ...updateSettingsRef.current,
          latestRelease: release,
          lastCheckedAt: checkedAt,
          lastAutomaticCheckAt: checkedAt,
        });
        const available = isVersionNewer(release.version, currentAppVersion);
        if (automatic && available && profile && screen !== "settings") {
          appDialog.confirm({
            title: t("updateAvailable"),
            message: t("updateAvailableDescription", {
              version: release.tagName,
            }),
            cancelLabel: t("later"),
            confirmLabel: t("viewUpdate"),
            onConfirm: () => {
              setFocusAppInformation(true);
              setScreen("settings");
            },
          });
        } else if (!automatic) {
          setNotice(
            available
              ? t("updateAvailableStatus", { version: release.tagName })
              : t("appIsUpToDate"),
          );
        }
      } catch (cause) {
        if (!automatic) {
          const retryable = isRetryableUpdateError(cause);
          appDialog.confirm({
            title: t("unableToCheckUpdates"),
            message: retryable
              ? t("updateNetworkError")
              : t("updateReleaseError"),
            cancelLabel: t("cancel"),
            confirmLabel: retryable ? t("retry") : t("openGitHub"),
            onConfirm: () => {
              if (retryable) {
                void checkForUpdatesRef.current(false);
              } else {
                void Linking.openURL(GITHUB_RELEASES_URL);
              }
            },
          });
        }
      } finally {
        updateCheckInFlight.current = false;
        setCheckingForUpdates(false);
      }
    }, [appDialog, persistUpdateSettings, profile, screen, t, updateSettingsStore]);
  checkForUpdatesRef.current = checkForUpdates;

  useEffect(() => {
    if (
      loading ||
      !profile ||
      !updateSettingsLoaded ||
      appState !== "active" ||
      !shouldAutomaticallyCheckForUpdates(updateSettingsRef.current)
    ) {
      return;
    }
    void checkForUpdates(true);
  }, [appState, checkForUpdates, loading, profile, updateSettingsLoaded]);

  const changeAutomaticUpdateChecks = useCallback(
    async (automaticChecks: boolean) => {
      const next = { ...updateSettingsRef.current, automaticChecks };
      await persistUpdateSettings(next);
      if (shouldAutomaticallyCheckForUpdates(next)) {
        void checkForUpdates(true);
      }
    },
    [checkForUpdates, persistUpdateSettings],
  );

  const latestRelease = updateSettings.latestRelease;
  const updateAvailable = Boolean(
    latestRelease && isVersionNewer(latestRelease.version, currentAppVersion),
  );
  const updateAsset = latestRelease
    ? selectAndroidApk(latestRelease, Device.supportedCpuArchitectures)
    : undefined;

  const changeBiometricUnlock = useCallback(
    async (enabled: boolean) => {
      if (!walletState.masterPasswordSet) return;
      const credential = enabled
        ? await requestMasterCredential("enableBiometrics", true)
        : undefined;
      setWalletState(
        await vault.setBiometricUnlock(credential),
      );
    },
    [requestMasterCredential, vault, walletState.masterPasswordSet],
  );

  const changeMasterPassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      assertWalletPassword(newPassword);
      const next = await vault.changeMasterPassword(oldPassword, newPassword);
      approvalQueue.cancelAll("Master password changed");
      setWalletState(next);
      setNotice(t("masterPasswordChanged"));
    },
    [approvalQueue, t, vault],
  );

  const downloadUpdate = useCallback(async () => {
    if (!updateAsset) {
      appDialog.confirm({
        title: t("unableToDownloadUpdate"),
        message: t("noCompatibleUpdate"),
        cancelLabel: t("cancel"),
        confirmLabel: t("openGitHub"),
        onConfirm: () => void Linking.openURL(GITHUB_RELEASES_URL),
      });
      return;
    }
    try {
      await Linking.openURL(updateAsset.downloadUrl);
    } catch {
      appDialog.confirm({
        title: t("unableToDownloadUpdate"),
        message: t("updateDownloadError"),
        cancelLabel: t("cancel"),
        confirmLabel: t("openGitHub"),
        onConfirm: () => void Linking.openURL(GITHUB_RELEASES_URL),
      });
    }
  }, [appDialog, t, updateAsset]);

  const releaseTrustConnection = useCallback(async () => {
    try {
      await disconnectTrustWallet();
    } finally {
      setTrustDevice(undefined);
    }
  }, []);

  const requestTrustSigningPin = useCallback<RequestTrustPin>(
    async (purpose, signal) => {
      signal?.throwIfAborted();
      const disconnectedProfile =
        (purpose === "message" || purpose === "transaction") &&
        profile?.kind === "cryptape-trust" &&
        profile.publicKey &&
        trustDevice?.id.toLowerCase() !== profile.deviceId.toLowerCase()
          ? profile
          : undefined;
      if (disconnectedProfile) {
        await ensureTrustBluetoothReady("connect");
        signal?.throwIfAborted();
      }

      const pin = await requestTrustPin(purpose, signal);
      signal?.throwIfAborted();
      if (!disconnectedProfile) {
        return pin;
      }
      const expectedPublicKey = disconnectedProfile.publicKey;
      if (!expectedPublicKey) return pin;

      const device = await connectTrustWallet(
        disconnectedProfile.deviceId,
        pin,
        disconnectedProfile.name,
      );
      signal?.throwIfAborted();
      if (
        !device.publicKey ||
        normalizeTrustPublicKey(device.publicKey) !==
          normalizeTrustPublicKey(expectedPublicKey)
      ) {
        await releaseTrustConnection().catch(() => undefined);
        throw new LocalizedError(
          "trustPublicKeyChanged",
          "Cryptape Trust public key has changed",
        );
      }
      setTrustDevice(device);
      return pin;
    },
    [profile, releaseTrustConnection, requestTrustPin, trustDevice],
  );

  const reportTrustSigningError = useCallback(
    (cause: unknown) => {
      if (
        cause instanceof Error &&
        (cause.name === "AbortError" ||
          cause.name === "TimeoutError" ||
          cause.message === "Cryptape Trust signing was cancelled")
      ) {
        return;
      }
      if (!showTrustBluetoothSetupError(cause)) {
        appDialog.show(t("trustSigningRequestFailed"), errorMessage(cause, t));
      }
    },
    [appDialog, showTrustBluetoothSetupError, t],
  );

  const localBackend = useMemo(
    () =>
      profile?.kind === "mnemonic"
        ? new LocalMnemonicSigningBackend(
            profile,
            async (purpose, signal) => {
              const mnemonic = (
                await requestWalletUnlock(profile.id, purpose, false, signal)
              ).mnemonic;
              if (!mnemonic) {
                throw new LocalizedError(
                  "walletUnavailable",
                  "Wallet is unavailable",
                );
              }
              return mnemonic;
            },
          )
        : undefined,
    [profile, requestWalletUnlock],
  );
  const trustBackend = useMemo(
    () =>
      profile?.kind === "cryptape-trust" && profile.publicKey
        ? new TrustHardwareSigningBackend(
            {
              id: profile.deviceId,
              name: profile.name,
              publicKey: profile.publicKey,
            },
            requestTrustSigningPin,
            releaseTrustConnection,
            reportTrustSigningError,
          )
        : undefined,
    [profile, releaseTrustConnection, reportTrustSigningError, requestTrustSigningPin],
  );
  const backend = profile?.kind === "cryptape-trust" ? trustBackend : localBackend;
  const backendRef = useRef(backend);
  backendRef.current = backend;

  const selectNetwork = useCallback(
    (next: Network) => {
      invalidateProviderSession();
      networkRef.current = next;
      setNetwork(next);
      if (backend) {
        signerRef.current = new KhieSignerAdapter(clients.current[next], backend);
      }
    },
    [backend, invalidateProviderSession],
  );

  useEffect(() => {
    invalidateProviderSession();
    if (!backend) {
      signerRef.current = undefined;
      return;
    }
    signerRef.current = new KhieSignerAdapter(clients.current[networkRef.current], backend);
  }, [backend, invalidateProviderSession]);

  useEffect(() => {
    if (!backendRef.current) {
      return;
    }
    const openProviderSession = () => {
      const currentBackend = backendRef.current;
      if (!currentBackend) {
        return undefined;
      }
      let approved:
        | {
            backend: NonNullable<typeof backendRef.current>;
            client: Signer["client"];
            network: Network;
            signal: AbortSignal;
          }
        | undefined;
      const validateApprovedContext = (
        context: NonNullable<typeof approved>,
      ) => {
        context.signal.throwIfAborted();
        if (
          backendRef.current !== context.backend ||
          networkRef.current !== context.network ||
          clients.current[context.network] !== context.client
        ) {
          const error = new Error("Khie request context changed");
          error.name = "AbortError";
          throw error;
        }
      };
      const takeApprovedContext = () => {
        const context = approved;
        approved = undefined;
        if (!context) {
          const error = new Error("Khie request was not approved");
          error.name = "AbortError";
          throw error;
        }
        validateApprovedContext(context);
        return context;
      };
      const providerSessionOwner = SignerJsonRpcProviderSession.open({
        getSigner: () => {
          if (!approved) {
            return signerRef.current;
          }
          const context = takeApprovedContext();
          return new KhieSignerAdapter(
            context.client,
            context.backend.forRequest(context.signal, () =>
              validateApprovedContext(context),
            ),
          );
        },
        getSignerMetadata: () => ({
          name:
            profile?.kind === "cryptape-trust"
              ? "Cryptape Trust"
              : "Khie Wallet",
        }),
        confirmRequest: async (request, options) => {
          const currentBackend = backendRef.current;
          if (!currentBackend) {
            throw new LocalizedError(
              "walletUnavailable",
              "Wallet is unavailable",
            );
          }
          const signal = options?.signal ?? new AbortController().signal;
          const currentNetwork = networkRef.current;
          const context = {
            signal,
            cancel: () => undefined,
          };
          const nextApproved = {
            backend: currentBackend,
            client: clients.current[currentNetwork],
            network: currentNetwork,
            signal,
          };
          try {
            const confirmed = await approvalQueue.enqueue(request, context);
            if (confirmed) {
              validateApprovedContext(nextApproved);
              approved = nextApproved;
            }
            return confirmed;
          } finally {
            approvalQueue.complete(context);
          }
        },
        connect: async (networkId, options) => {
          const signal = options?.signal ?? new AbortController().signal;
          signal.throwIfAborted();
          const context = takeApprovedContext();
          const next = networkFromId(networkId);
          const signer = new KhieSignerAdapter(
            clients.current[next],
            context.backend,
          );
          signal.throwIfAborted();
          networkRef.current = next;
          signerRef.current = signer;
          setNetwork(next);
          return signer;
        },
      } satisfies SignerJsonRpcProviderSessionConfig);
      providerSessionOwnerRef.current = providerSessionOwner;
      return providerSessionOwner;
    };
    const handler = async (payload: JsonRpcPayload) => {
      // This owner outlives each libp2p request so a timed-out transport does
      // not cancel the operation cached for a later get_result recovery.
      const providerSessionOwner =
        providerSessionOwnerRef.current ?? openProviderSession();
      if (!providerSessionOwner) {
        throw new LocalizedError("walletUnavailable", "Wallet is unavailable");
      }
      return providerSessionOwner.value.handle(payload);
    };
    const session = new KhieProviderSession({
      endpointUrl,
      handler,
      onStateChange: (next) => {
        setSessionState(next);
        if (previousPaired.current && !next.paired) {
          approvalQueue.cancelAll("Khie peer was unpaired");
          invalidateProviderSession();
        }
        previousPaired.current = next.paired;
      },
    });
    sessionRef.current = session;
    void session.start().catch((cause: unknown) => setNotice(errorMessage(cause, tRef.current)));
    return () => {
      approvalQueue.cancelAll("Khie session closed");
      const providerSessionOwner = providerSessionOwnerRef.current;
      providerSessionOwnerRef.current = undefined;
      sessionRef.current = undefined;
      finishKhieHeadlessTask();
      void stopKhieBackgroundService().catch(() => undefined);
      void dismissKhieConnectionNotification().catch(() => undefined);
      void dismissKhieRequestNotification().catch(() => undefined);
      void Promise.all([session.close(), providerSessionOwner?.dispose()]);
    };
  }, [approvalQueue, backend?.account.publicKey, invalidateProviderSession, profile?.kind]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppState(state);
      // Android may suspend a transport in the background, but the logical
      // pairing and pending confirmations stay valid until explicitly canceled.
      void resumeKhieSessionWhenActive(state, sessionRef.current);
    });
    return () => subscription.remove();
  }, []);

  const changeNetwork = useCallback(
    (next: Network) => {
      if (next === networkRef.current) {
        return;
      }
      if (sessionState.paired) {
        void sessionRef.current?.unpair();
      }
      approvalQueue.cancelAll("Network changed");
      selectNetwork(next);
    },
    [approvalQueue, selectNetwork, sessionState.paired],
  );

  const saveRpcUrls = useCallback(
    async (next: NetworkRpcUrls) => {
      const saved = await networkSettings.save(next);
      clients.current = {
        mainnet: clientForNetwork("mainnet", saved.mainnet),
        testnet: clientForNetwork("testnet", saved.testnet),
      };
      setRpcUrls(saved);
      approvalQueue.cancelAll("Network RPC URL changed");
      invalidateProviderSession();
      if (backend) {
        signerRef.current = new KhieSignerAdapter(
          clients.current[networkRef.current],
          backend,
        );
      }
    },
    [approvalQueue, backend, invalidateProviderSession, networkSettings],
  );

  const pairKhieEndpoint = useCallback(async (endpoint: string) => {
    const session = sessionRef.current;
    if (!session || !endpoint.trim()) {
      return false;
    }
    setPairing(true);
    try {
      return await session.pair(endpoint);
    } finally {
      setPairing(false);
    }
  }, []);

  const cancelKhiePairing = useCallback(() => {
    sessionRef.current?.cancelPairing();
    setPairing(false);
  }, []);

  const activateWalletState = useCallback(
    (next: WalletState, navigateHome = true) => {
      const nextProfile =
        next.wallets.find((wallet) => wallet.id === next.selectedWalletId) ?? next.wallets[0];
      if (profile && profile.id !== nextProfile?.id) {
        if (sessionState.paired) {
          void sessionRef.current?.unpair().catch(() => undefined);
        }
        approvalQueue.cancelAll("Wallet changed");
      }
      setWalletState(next);
      if (navigateHome) {
        setScreen("home");
      }
    },
    [approvalQueue, profile, sessionState.paired],
  );

  const connectTrust = useCallback(
    async (deviceId: string, cachedName?: string) => {
      await ensureTrustBluetoothReady("connect");
      const pin = await new Promise<string>((resolve, reject) => {
        let active = true;
        setTrustPin("");
        setTrustPinRequest({
          active: () => active,
          purpose: "connect",
          deviceId,
          reject: (cause) => {
            if (!active) return;
            active = false;
            reject(cause);
          },
          resolve: (value) => {
            if (!active) return;
            active = false;
            resolve(value);
          },
        });
      });
      const device = await connectTrustWallet(deviceId, pin, cachedName);
      setTrustDevice(device);
      return device;
    },
    [],
  );

  const clearTrustConnection = useCallback(async () => {
    await releaseTrustConnection();
    approvalQueue.cancelAll("Wallet changed");
  }, [approvalQueue, releaseTrustConnection]);

  const addTrustWallet = useCallback(
    async (scannedDevice: TrustDevice) => {
      try {
        const device = await connectTrust(scannedDevice.id, scannedDevice.name);
        setWalletState(await vault.saveCryptapeTrust(device));
        setOnboarding("start");
        setAddingWallet(false);
        setScreen("trust");
      } finally {
        await releaseTrustConnection().catch(() => undefined);
      }
    },
    [connectTrust, releaseTrustConnection, vault],
  );

  const activateTrustKey = useCallback(
    async (device: ConnectedTrustDevice, publicKey: string) => {
      const next = { ...device, publicKey };
      approvalQueue.cancelAll("Wallet changed");
      setTrustDevice(next);
      setWalletState(await vault.saveCryptapeTrust(next));
    },
    [approvalQueue, vault],
  );

  const prepareTrustKeyOperation = useCallback(async () => {
    if (profile?.kind !== "cryptape-trust") {
      throw new LocalizedError("walletUnavailable", "Wallet is unavailable");
    }
    const connected = trustDevice?.id.toLowerCase() === profile.deviceId.toLowerCase();
    if (!connected) {
      await ensureTrustBluetoothReady("connect");
    }
    const pin = await requestTrustPin("keyManagement");
    if (connected) {
      return { device: trustDevice, pin };
    }

    const device = await connectTrustWallet(profile.deviceId, pin, profile.name);
    setTrustDevice(device);
    setWalletState(await vault.saveCryptapeTrust(device));
    if (hasTrustPublicKeyChanged(profile.publicKey, device.publicKey)) {
      approvalQueue.cancelAll("Wallet changed");
      if (sessionState.paired) {
        void sessionRef.current?.unpair().catch(() => undefined);
      }
      throw new LocalizedError(
        "trustPublicKeyChanged",
        "Cryptape Trust public key has changed",
      );
    }
    return { device, pin };
  }, [approvalQueue, profile, requestTrustPin, sessionState.paired, trustDevice, vault]);

  const performTrustKeyOperation = useCallback(
    async <T,>(
      operation: (device: ConnectedTrustDevice, pin: string) => Promise<T>,
    ): Promise<T> => {
      try {
        const { device, pin } = await prepareTrustKeyOperation();
        return await operation(device, pin);
      } finally {
        await releaseTrustConnection().catch(() => undefined);
      }
    },
    [prepareTrustKeyOperation, releaseTrustConnection],
  );

  const generateTrustKey = useCallback(async () => {
    await performTrustKeyOperation(async (device, pin) => {
      await activateTrustKey(device, await generateTrustWalletKey(pin));
    });
  }, [activateTrustKey, performTrustKeyOperation]);

  const importTrustKey = useCallback(
    async (value: string) => {
      const pair = prepareTrustKeyImport(value);
      await performTrustKeyOperation(async (device, pin) => {
        const publicKey = await importTrustWalletKey(
          pair.privateKey,
          pair.publicKey,
          pin,
        );
        if (publicKey.toLowerCase() !== pair.publicKey.toLowerCase()) {
          throw new LocalizedError(
            "trustPublicKeyImportMismatch",
            "Cryptape Trust returned a different public key after import",
          );
        }
        await activateTrustKey(device, publicKey);
      });
    },
    [activateTrustKey, performTrustKeyOperation],
  );

  const resetTrustKey = useCallback(async () => {
    await performTrustKeyOperation(async (device, pin) => {
      await resetTrustWalletKey(pin);
      approvalQueue.cancelAll("Wallet changed");
      setWalletState(
        await vault.saveCryptapeTrust({ ...device, publicKey: undefined }),
      );
    });
  }, [approvalQueue, performTrustKeyOperation, vault]);

  const refreshSelectedTrust = useCallback(async () => {
    if (profile?.kind !== "cryptape-trust") {
      throw new LocalizedError("walletUnavailable", "Wallet is unavailable");
    }
    try {
      const device = await connectTrust(profile.deviceId, profile.name);
      if (hasTrustPublicKeyChanged(profile.publicKey, device.publicKey)) {
        approvalQueue.cancelAll("Wallet changed");
        if (sessionState.paired) {
          void sessionRef.current?.unpair().catch(() => undefined);
        }
      }
      setWalletState(await vault.saveCryptapeTrust(device));
    } finally {
      await releaseTrustConnection().catch(() => undefined);
    }
  }, [
    approvalQueue,
    connectTrust,
    profile,
    releaseTrustConnection,
    sessionState.paired,
    vault,
  ]);

  const selectWallet = useCallback(
    async (walletId: string) => {
      const target = walletState.wallets.find((wallet) => wallet.id === walletId);
      if (!target) {
        throw new LocalizedError("walletUnavailable", "Wallet is unavailable");
      }
      if (profile?.id !== target.id && sessionState.paired) {
        await sessionRef.current?.unpair().catch(() => undefined);
        approvalQueue.cancelAll("Wallet changed");
      }
      if (target.kind === "cryptape-trust") {
        if (
          trustDevice &&
          trustDevice.id.toLowerCase() !== target.deviceId.toLowerCase()
        ) {
          await clearTrustConnection();
        }
        activateWalletState(await vault.select(walletId), false);
        return;
      }
      if (trustDevice) await clearTrustConnection();
      activateWalletState(await vault.select(walletId), false);
    },
    [
      activateWalletState,
      approvalQueue,
      clearTrustConnection,
      profile?.id,
      sessionState.paired,
      trustDevice,
      vault,
      walletState.wallets,
    ],
  );

  const trustDialogs = (
    <Portal>
      {biometricUnlocking ? (
        <Notice text={t("unlockingWallet")} onDismiss={() => undefined} />
      ) : null}
      <KeyboardAvoidingView
        behavior="height"
        pointerEvents="box-none"
        style={styles.keyboardDialogLayer}
      >
        <Dialog
          visible={Boolean(trustPinRequest) && !trustPinResetOpen}
          dismissable={false}
          style={styles.keyboardDialog}
        >
          <Dialog.Title>
            {t(
              trustPinRequest?.purpose === "connect"
                ? "trustPinConnect"
                : trustPinRequest?.purpose === "transaction"
                  ? "trustPinTransaction"
                  : trustPinRequest?.purpose === "keyManagement"
                    ? "trustPinKeyManagement"
                    : "trustPinMessage",
            )}
          </Dialog.Title>
          <KeyboardDialogContent>
            <Text variant="bodyMedium">{t("trustPinDescription")}</Text>
            <WalletTextInput
              autoFocus
              label={t("trustPin")}
              keyboardType="number-pad"
              maxLength={8}
              onSubmitEditing={submitTrustPin}
              returnKeyType="done"
              secureTextEntry
              value={trustPin}
              onChangeText={(value) => setTrustPin(value.replace(/\D/g, ""))}
            />
          </KeyboardDialogContent>
          <Dialog.Actions style={styles.dialogActions}>
            {trustPinRequest?.purpose === "connect" ? (
              <PaperButton
                contentStyle={styles.extraHorizontalButtonPadding}
                onPress={() => {
                  setTrustPuk("");
                  setTrustNewPin("");
                  setTrustConfirmPin("");
                  setTrustPinResetOpen(true);
                }}
              >
                {t("resetWithPuk")}
              </PaperButton>
            ) : null}
            <PaperButton
              contentStyle={styles.extraHorizontalButtonPadding}
              onPress={() => {
                const request = trustPinRequest;
                request?.reject(
                  new Error(
                    request.purpose === "keyManagement"
                      ? "Cryptape Trust key operation was cancelled"
                      : "Cryptape Trust signing was cancelled",
                  ),
                );
                setTrustPinRequest(undefined);
                setTrustPin("");
                void KeyboardController.dismiss({ animated: false });
              }}
            >
              {t("cancel")}
            </PaperButton>
            <PaperButton
              mode="contained"
              contentStyle={styles.extraHorizontalButtonPadding}
              disabled={trustPin.length !== 8}
              onPress={submitTrustPin}
            >
              {t("continue")}
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
        <Dialog
          visible={trustPinResetOpen}
          dismissable={false}
          style={styles.keyboardDialog}
        >
          <Dialog.Title>{t("resetTrustPinTitle")}</Dialog.Title>
          <KeyboardDialogContent>
            <Text variant="bodyMedium">{t("resetTrustPinDescription")}</Text>
            <WalletTextInput
              autoCapitalize="characters"
              label={t("trustPuk")}
              maxLength={16}
              secureTextEntry
              value={trustPuk}
              onChangeText={(value) =>
                setTrustPuk(value.replace(/[^0-9a-f]/gi, "").toUpperCase())
              }
            />
            <WalletTextInput
              label={t("newTrustPin")}
              keyboardType="number-pad"
              maxLength={8}
              secureTextEntry
              value={trustNewPin}
              onChangeText={(value) => setTrustNewPin(value.replace(/\D/g, ""))}
            />
            <WalletTextInput
              label={t("confirmTrustPin")}
              keyboardType="number-pad"
              maxLength={8}
              secureTextEntry
              value={trustConfirmPin}
              onChangeText={(value) => setTrustConfirmPin(value.replace(/\D/g, ""))}
            />
            {trustConfirmPin.length === 8 && trustConfirmPin !== trustNewPin ? (
              <HelperText type="error" visible>
                {t("trustPinMismatch")}
              </HelperText>
            ) : null}
          </KeyboardDialogContent>
          <Dialog.Actions style={styles.dialogActions}>
            <PaperButton
              contentStyle={styles.extraHorizontalButtonPadding}
              disabled={resettingTrustPin}
              onPress={() => {
                setTrustPinResetOpen(false);
                void KeyboardController.dismiss({ animated: false });
              }}
            >
              {t("cancel")}
            </PaperButton>
            <PaperButton
              mode="contained"
              contentStyle={styles.extraHorizontalButtonPadding}
              loading={resettingTrustPin}
              disabled={
                resettingTrustPin ||
                trustPuk.length !== 16 ||
                trustNewPin.length !== 8 ||
                trustNewPin !== trustConfirmPin
              }
              onPress={() => {
                const request = trustPinRequest;
                if (!request?.deviceId) return;
                setResettingTrustPin(true);
                void resetTrustWalletPin(request.deviceId, trustPuk, trustNewPin)
                  .then(() => {
                    const newPin = trustNewPin;
                    setTrustPinResetOpen(false);
                    setTrustPuk("");
                    setTrustNewPin("");
                    setTrustConfirmPin("");
                    setTrustPinRequest(undefined);
                    request.resolve(newPin);
                    setNotice(t("trustPinResetSuccess"));
                  })
                  .catch((cause: unknown) => {
                    if (!showTrustBluetoothSetupError(cause)) {
                      appDialog.show(
                        t("trustPinResetFailed"),
                        errorMessage(cause, t),
                      );
                    }
                  })
                  .finally(() => setResettingTrustPin(false));
              }}
            >
              {t("resetTrustPin")}
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
        <Dialog
          visible={Boolean(walletPasswordRequest)}
          dismissable={false}
          style={styles.keyboardDialog}
        >
          <Dialog.Title>{t("enterWalletPassword")}</Dialog.Title>
          <KeyboardDialogContent>
            <WalletTextInput
              autoFocus
              label={t("walletPassword")}
              secureTextEntry
              returnKeyType="done"
              value={walletPassword}
              error={Boolean(walletPasswordError)}
              onChangeText={(value) => {
                setWalletPassword(value);
                setWalletPasswordError(undefined);
              }}
              onSubmitEditing={() => void submitWalletPassword()}
            />
            {walletPasswordError ? (
              <HelperText type="error" visible>
                {walletPasswordError}
              </HelperText>
            ) : null}
          </KeyboardDialogContent>
          <Dialog.Actions style={styles.dialogActions}>
            <PaperButton
              contentStyle={styles.extraHorizontalButtonPadding}
              disabled={unlockingWallet}
              onPress={() => {
                walletPasswordRequest?.reject(
                  new Error("Wallet unlock was cancelled"),
                );
                setWalletPasswordRequest(undefined);
                setWalletPassword("");
                setWalletPasswordError(undefined);
                void KeyboardController.dismiss({ animated: true });
              }}
            >
              {t("cancel")}
            </PaperButton>
            <PaperButton
              mode="contained"
              contentStyle={styles.extraHorizontalButtonPadding}
              loading={unlockingWallet}
              disabled={unlockingWallet || !walletPassword}
              onPress={() => void submitWalletPassword()}
            >
              {t("unlock")}
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
      </KeyboardAvoidingView>
    </Portal>
  );

  const khieNotificationPermissionDialog = (
    <Portal>
      <Dialog
        visible={khieNotificationPromptOpen}
        onDismiss={() => {
          khieNotificationPromptDismissed.current = true;
          setKhieNotificationPromptOpen(false);
        }}
      >
        <Dialog.Icon icon="bell-outline" />
        <Dialog.Title style={styles.centerText}>
          {t("khieNotificationsPermissionTitle")}
        </Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">
            {t("khieNotificationsPermissionDescription")}
          </Text>
        </Dialog.Content>
        <Dialog.Actions style={styles.dialogActions}>
          <PaperButton
            contentStyle={styles.extraHorizontalButtonPadding}
            onPress={() => {
              khieNotificationPromptDismissed.current = true;
              setKhieNotificationPromptOpen(false);
            }}
          >
            {t("notNow")}
          </PaperButton>
          <PaperButton
            mode="contained"
            contentStyle={styles.extraHorizontalButtonPadding}
            onPress={() => {
              khieNotificationPromptDismissed.current = true;
              setKhieNotificationPromptOpen(false);
              void requestKhieNotificationPermission()
                .then(setKhieNotificationPermission)
                .catch(() => setKhieNotificationPermission("denied"));
            }}
          >
            {t("allow")}
          </PaperButton>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );

  const finishOnboarding = async (next: WalletState) => {
    if (trustDevice) {
      await clearTrustConnection();
    }
    activateWalletState(next);
    setOnboarding("start");
    setAddingWallet(false);
  };

  return (
    <WalletRouter
      loading={loading}
      screen={screen}
      profile={profile}
      wallets={walletState.wallets}
      signer={signerRef.current}
      network={network}
      onboarding={{
        mode: onboarding,
        vault,
        hasMasterPassword: walletState.masterPasswordSet,
        onUnlockMasterPassword: () => requestMasterCredential("useWallet"),
        onMode: setOnboarding,
        onComplete: finishOnboarding,
        onConnectTrust: addTrustWallet,
        onError: (cause) => setNotice(errorMessage(cause, t)),
      }}
      addingWallet={addingWallet}
      sessionState={sessionState}
      pairing={pairing}
      approval={approval}
      localBackend={localBackend}
      rpcUrls={rpcUrls}
      themePreference={themePreference}
      updateSettings={updateSettings}
      checkingForUpdates={checkingForUpdates}
      currentVersion={currentAppVersion}
      buildCommit={currentBuildCommit}
      appArchitecture={currentAppArchitecture}
      updateAvailable={updateAvailable}
      updateAsset={updateAsset}
      focusAppInformation={focusAppInformation}
      biometricAvailable={vault.canUseBiometrics()}
      biometricUnlock={walletState.biometricUnlock}
      masterPasswordSet={walletState.masterPasswordSet}
      notice={notice}
      dialogs={<>{trustDialogs}{khieNotificationPermissionDialog}</>}
      onDismissNotice={() => setNotice(undefined)}
      onScreenChange={(next) => {
        const leavingKhiePairing =
          next !== "khie" &&
          next !== "scanner" &&
          sessionRef.current?.snapshot.paired !== true;
        if (leavingKhiePairing) {
          sessionRef.current?.setPairingEnabled(false);
          setPairing(false);
        }
        setScreen(next);
      }}
      onFinishOnboarding={finishOnboarding}
      onCancelAddingWallet={() => {
        setAddingWallet(false);
        setOnboarding("start");
      }}
      onPairKhie={pairKhieEndpoint}
      onCancelKhiePairing={cancelKhiePairing}
      onConnectRelay={(address) =>
        sessionRef.current?.connectRelay(address) ?? Promise.resolve(false)
      }
      onUnpairKhie={() => sessionRef.current?.unpair() ?? Promise.resolve()}
      onRespondToApproval={(approved) =>
        approval && approvalQueue.respond(approval.id, approved)
      }
      onRefreshTrust={refreshSelectedTrust}
      onGenerateTrustKey={generateTrustKey}
      onImportTrustKey={importTrustKey}
      onResetTrustKey={resetTrustKey}
      onChangeNetwork={changeNetwork}
      onChangeBiometricUnlock={changeBiometricUnlock}
      onChangeMasterPassword={changeMasterPassword}
      onAddWallet={() => {
        setOnboarding("start");
        setAddingWallet(true);
      }}
      onSelectWallet={selectWallet}
      onRemoveWallet={async (walletId) => {
        const removed = walletState.wallets.find((wallet) => wallet.id === walletId);
        if (
          removed?.kind === "cryptape-trust" &&
          trustDevice?.id.toLowerCase() === removed.deviceId.toLowerCase()
        ) {
          await clearTrustConnection();
        }
        if (walletId === profile?.id && sessionState.paired) {
          void sessionRef.current?.unpair().catch(() => undefined);
        }
        approvalQueue.cancelAll("Wallet removed");
        const next = await vault.remove(walletId);
        setWalletState(next);
        setScreen(next.wallets.length ? "settings" : "home");
      }}
      onSaveRpcUrls={async (next) => {
        await saveRpcUrls(next);
        setNotice(t("rpcUrlsSaved"));
      }}
      onChangeThemePreference={onChangeThemePreference}
      onChangeAutomaticUpdateChecks={changeAutomaticUpdateChecks}
      onCheckForUpdates={() => checkForUpdates(false)}
      onDownloadUpdate={downloadUpdate}
      onAppInformationFocused={() => setFocusAppInformation(false)}
    />
  );
}
