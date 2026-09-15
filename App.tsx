import {
  buildSignerJsonRpcHandler,
  fixedPointToString,
  SignerCkbPublicKey,
  type Signer,
  type SignerJsonRpcConfirmation,
} from "@ckb-ccc/core";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { NavigationBar } from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState,
  BackHandler,
  ImageBackground,
  Linking,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import {
  ActivityIndicator,
  BottomNavigation,
  Button as PaperButton,
  Card as PaperCard,
  Chip,
  Dialog,
  Divider,
  HelperText,
  Icon,
  IconButton,
  List,
  Menu,
  PaperProvider,
  Portal,
  SegmentedButtons,
  Snackbar,
  Switch,
  Text,
  TextInput as PaperTextInput,
  useTheme,
} from "react-native-paper";
import QRCode from "react-native-qrcode-svg";
import {
  KeyboardAvoidingView,
  KeyboardAwareScrollView,
  KeyboardController,
  KeyboardProvider,
  type KeyboardAwareScrollViewRef,
} from "react-native-keyboard-controller";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { RecommendedAppIcon } from "./src/components/RecommendedAppIcon";
import { LocalizedError } from "./src/errors";
import {
  CryptapeIcon,
  cryptapeIconSource,
} from "./src/components/CryptapeIcon";
import { InfoCard } from "./src/components/InfoCard";
import { KhieIcon, khieIconSource } from "./src/components/KhieIcon";
import {
  I18nProvider,
  languageLabel,
  languageOptions,
  useI18n,
  type Translate,
} from "./src/i18n";
import { ApprovalQueue, type ApprovalItem } from "./src/khie/approvalQueue";
import { resumeKhieSessionWhenActive } from "./src/khie/appLifecycle";
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
import { TransactionApprovalDetails } from "./src/khie/TransactionApprovalDetails";
import {
  KhieProviderSession,
  type KhieProviderSessionError,
  type KhieProviderSessionState,
} from "./src/khie/KhieProviderSession";
import { DEFAULT_KHIE_RELAY_ADDRESS } from "./src/khie/protocol";
import {
  connectTrustWallet,
  disconnectTrustWallet,
  ensureTrustBluetoothReady,
  generateTrustWalletKey,
  importTrustWalletKey,
  isTrustSupported,
  resetTrustWalletKey,
  resetTrustWalletPin,
  scanForTrustDevices,
  TrustBluetoothSetupError,
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
  type WalletAuthenticationPurpose,
} from "./src/storage/walletVault";
import { LocalMnemonicSigningBackend } from "./src/wallet/localMnemonicBackend";
import { KhieSignerAdapter } from "./src/wallet/khieSignerAdapter";
import {
  TrustHardwareSigningBackend,
  type RequestTrustPin,
} from "./src/wallet/trustHardwareBackend";
import {
  createMnemonicChallenges,
  type MnemonicChallenge,
} from "./src/wallet/mnemonicChallenge";
import { assertValidMnemonic } from "./src/wallet/derivation";
import {
  DEFAULT_NETWORK_RPC_URLS,
  clientForNetwork,
  isRpcUrl,
  networkFromId,
  type NetworkRpcUrls,
} from "./src/wallet/network";
import {
  normalizeTrustPublicKey,
  prepareTrustKeyImport,
} from "./src/wallet/trustSignature";
import {
  assertWalletPassword,
  deriveWalletPasswordCredential,
  MIN_WALLET_PASSWORD_LENGTH,
} from "./src/wallet/password";
import type { Network, WalletProfile, WalletState } from "./src/wallet/types";
import {
  generateMnemonic,
  persistFirstMnemonicWallet,
  persistWallet,
} from "./src/wallet/walletService";
import { walletDarkTheme, walletLightTheme } from "./src/theme";
import {
  fetchLatestRelease,
  GITHUB_RELEASES_URL,
  GITHUB_REPOSITORY_URL,
  isRetryableUpdateError,
  isVersionNewer,
  selectAndroidApk,
  type ReleaseAsset,
} from "./src/update/githubRelease";

type Screen = "home" | "receive" | "khie" | "trust" | "settings" | "scanner";
type Onboarding = "start" | "create" | "confirm" | "password" | "restore" | "trust";
type WalletUnlockResult = {
  mnemonic?: string;
  passwordCredential: string;
};
type WalletPasswordRequest = {
  purpose: WalletAuthenticationPurpose;
  reject: (cause: Error) => void;
  resolve: (result: WalletUnlockResult) => void;
  walletId?: string;
};
type TrustPinRequest = {
  purpose: "connect" | "message" | "transaction" | "keyManagement";
  deviceId?: string;
  reject: (cause: Error) => void;
  resolve: (pin: string) => void;
};
type TrustBluetoothSetupContextValue = {
  show: (cause: unknown) => boolean;
};
type AppDialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
};
type AppDialogContextValue = {
  show: (title: string, message: string) => void;
  confirm: (dialog: AppDialogState) => void;
};

const TrustBluetoothSetupContext = createContext<
  TrustBluetoothSetupContextValue | undefined
>(undefined);
const AppDialogContext = createContext<AppDialogContextValue | undefined>(
  undefined,
);

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
  const theme = useTheme();
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
    version: 4,
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
    (purpose) =>
      new Promise((resolve, reject) => {
        setTrustPin("");
        setTrustPinRequest({ purpose, reject, resolve });
      }),
    [],
  );

  const submitTrustPin = useCallback(() => {
    if (!trustPinRequest || trustPin.length !== 8) return;
    trustPinRequest.resolve(trustPin);
    setTrustPinRequest(undefined);
    setTrustPin("");
    void KeyboardController.dismiss({ animated: true });
  }, [trustPin, trustPinRequest]);

  const requestPasswordUnlock = useCallback(
    (purpose: WalletAuthenticationPurpose, walletId?: string) =>
      new Promise<WalletUnlockResult>((resolve, reject) => {
        setWalletPassword("");
        setWalletPasswordError(undefined);
        setWalletPasswordRequest((current) => {
          current?.reject(new Error("Wallet unlock was cancelled"));
          return { purpose, reject, resolve, walletId };
        });
      }),
    [],
  );

  const requestWalletUnlock = useCallback(
    async (
      walletId: string,
      purpose: WalletAuthenticationPurpose,
      forcePassword = false,
    ): Promise<WalletUnlockResult> => {
      const wallet = walletStateRef.current.wallets.find(
        (candidate) => candidate.id === walletId,
      );
      if (!wallet || wallet.kind !== "mnemonic") {
        throw new LocalizedError("walletUnavailable", "Wallet is unavailable");
      }

      if (walletStateRef.current.biometricUnlock && !forcePassword) {
        let passwordCredential: string | null = null;
        let credentialRead = false;
        setBiometricUnlocking(true);
        try {
          passwordCredential = await vault.readBiometricCredential(purpose);
          credentialRead = true;
          if (passwordCredential) {
            return {
              mnemonic: await vault.readMnemonic(walletId, passwordCredential),
              passwordCredential,
            };
          }
        } catch {
          // Cancelling or temporarily failing system authentication falls back
          // to the wallet password without changing the biometric preference.
        } finally {
          setBiometricUnlocking(false);
        }
        if (credentialRead && !passwordCredential) {
          void vault
            .setBiometricUnlock()
            .then(setWalletState)
            .catch(() => undefined);
        }
      }

      return requestPasswordUnlock(purpose, walletId);
    },
    [requestPasswordUnlock, vault],
  );

  const submitWalletPassword = useCallback(async () => {
    const request = walletPasswordRequest;
    if (!request || unlockingWallet || !walletPassword) return;
    setUnlockingWallet(true);
    setWalletPasswordError(undefined);
    try {
      const passwordCredential = await deriveWalletPasswordCredential(walletPassword);
      const mnemonic = request.walletId
        ? await vault.readMnemonic(request.walletId, passwordCredential)
        : undefined;
      if (!request.walletId && !(await vault.verifyMasterCredential(passwordCredential))) {
        throw new LocalizedError("invalidWalletPassword", "Invalid password");
      }
      request.resolve({ mnemonic, passwordCredential });
      setWalletPasswordRequest(undefined);
      setWalletPassword("");
      void KeyboardController.dismiss({ animated: true });
    } catch (cause) {
      setWalletPasswordError(errorMessage(cause, t));
    } finally {
      setUnlockingWallet(false);
    }
  }, [t, unlockingWallet, vault, walletPassword, walletPasswordRequest]);

  const requestMasterCredential = useCallback(
    async (
      purpose: WalletAuthenticationPurpose,
      forcePassword = false,
    ): Promise<string> => {
      const state = walletStateRef.current;
      if (state.biometricUnlock && !forcePassword) {
        let credentialRead = false;
        setBiometricUnlocking(true);
        try {
          const credential = await vault.readBiometricCredential(purpose);
          credentialRead = true;
          if (credential) {
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
      return (await requestPasswordUnlock(purpose)).passwordCredential;
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
    if (!sessionState.paired) {
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
    sessionState.paired,
  ]);

  useEffect(() => {
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
      const passwordCredential = enabled
        ? await requestMasterCredential("enableBiometrics", true)
        : undefined;
      setWalletState(
        await vault.setBiometricUnlock(passwordCredential),
      );
    },
    [requestMasterCredential, vault, walletState.masterPasswordSet],
  );

  const changeMasterPassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      assertWalletPassword(newPassword);
      const [oldCredential, newCredential] = await Promise.all([
        deriveWalletPasswordCredential(oldPassword),
        deriveWalletPasswordCredential(newPassword),
      ]);
      const next = await vault.changeMasterPassword(oldCredential, newCredential);
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
    async (purpose) => {
      const disconnectedProfile =
        (purpose === "message" || purpose === "transaction") &&
        profile?.kind === "cryptape-trust" &&
        profile.publicKey &&
        trustDevice?.id.toLowerCase() !== profile.deviceId.toLowerCase()
          ? profile
          : undefined;
      if (disconnectedProfile) {
        try {
          await ensureTrustBluetoothReady("connect");
        } catch (cause) {
          showTrustBluetoothSetupError(cause);
          throw cause;
        }
      }

      const pin = await requestTrustPin(purpose);
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

  const localBackend = useMemo(
    () =>
      profile?.kind === "mnemonic"
        ? new LocalMnemonicSigningBackend(
            profile,
            async (purpose) => {
              const mnemonic = (await requestWalletUnlock(profile.id, purpose)).mnemonic;
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
          )
        : undefined,
    [profile, releaseTrustConnection, requestTrustSigningPin],
  );
  const backend = profile?.kind === "cryptape-trust" ? trustBackend : localBackend;
  const backendRef = useRef(backend);
  backendRef.current = backend;

  const selectNetwork = useCallback(
    (next: Network) => {
      networkRef.current = next;
      setNetwork(next);
      if (backend) {
        signerRef.current = new KhieSignerAdapter(clients.current[next], backend);
      }
    },
    [backend],
  );

  useEffect(() => {
    if (!backend) {
      signerRef.current = undefined;
      return;
    }
    signerRef.current = new KhieSignerAdapter(clients.current[networkRef.current], backend);
  }, [backend]);

  useEffect(() => {
    if (!backendRef.current) {
      return;
    }
    const handler = buildSignerJsonRpcHandler({
      getSigner: () => signerRef.current,
      getSignerMetadata: () => ({
        name: profile?.kind === "cryptape-trust" ? "Cryptape Trust" : "Khie Wallet",
      }),
      confirmRequest: (request) => approvalQueue.enqueue(request),
      connect: async (networkId) => {
        const currentBackend = backendRef.current;
        if (!currentBackend) {
          throw new LocalizedError("walletUnavailable", "Wallet is unavailable");
        }
        const next = networkFromId(networkId);
        networkRef.current = next;
        const signer = new KhieSignerAdapter(clients.current[next], currentBackend);
        signerRef.current = signer;
        setNetwork(next);
        return signer;
      },
    });
    const session = new KhieProviderSession({
      endpointUrl,
      handler,
      onStateChange: (next) => {
        setSessionState(next);
        if (previousPaired.current && !next.paired) {
          approvalQueue.cancelAll("Khie peer was unpaired");
        }
        previousPaired.current = next.paired;
      },
    });
    sessionRef.current = session;
    void session.start().catch((cause: unknown) => setNotice(errorMessage(cause, tRef.current)));
    return () => {
      approvalQueue.cancelAll("Khie session closed");
      sessionRef.current = undefined;
      void dismissKhieConnectionNotification().catch(() => undefined);
      void dismissKhieRequestNotification().catch(() => undefined);
      void session.close();
    };
  }, [approvalQueue, backend?.account.publicKey, profile?.kind]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppState(state);
      // Android may suspend a transport in the background, but the logical
      // pairing and any pending confirmation stay valid until their own timeout.
      void resumeKhieSessionWhenActive(state, sessionRef.current);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (screen !== "receive") {
      return;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setScreen("home");
      return true;
    });
    return () => subscription.remove();
  }, [screen]);

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
      if (backend) {
        signerRef.current = new KhieSignerAdapter(
          clients.current[networkRef.current],
          backend,
        );
      }
    },
    [approvalQueue, backend, networkSettings],
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
        setTrustPin("");
        setTrustPinRequest({ purpose: "connect", deviceId, reject, resolve });
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

  if (loading) {
    return <LoadingScreen />;
  }

  const finishOnboarding = async (next: WalletState) => {
    if (trustDevice) {
      await clearTrustConnection();
    }
    activateWalletState(next);
    setOnboarding("start");
    setAddingWallet(false);
  };

  if (!profile) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <StatusBar style={theme.dark ? "light" : "dark"} />
        {notice ? <Notice text={notice} onDismiss={() => setNotice(undefined)} /> : null}
        <OnboardingScreen
          mode={onboarding}
          vault={vault}
          hasMasterPassword={walletState.masterPasswordSet}
          onUnlockMasterPassword={() => requestMasterCredential("useWallet")}
          onMode={setOnboarding}
          onComplete={finishOnboarding}
          onConnectTrust={addTrustWallet}
          onError={(cause) => setNotice(errorMessage(cause, t))}
        />
        {trustDialogs}
      </SafeAreaView>
    );
  }

  if (addingWallet) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <StatusBar style={theme.dark ? "light" : "dark"} />
        {notice ? <Notice text={notice} onDismiss={() => setNotice(undefined)} /> : null}
        <OnboardingScreen
          mode={onboarding}
          vault={vault}
          hasMasterPassword={walletState.masterPasswordSet}
          onUnlockMasterPassword={() => requestMasterCredential("useWallet")}
          onMode={setOnboarding}
          onComplete={finishOnboarding}
          onConnectTrust={addTrustWallet}
          onCancel={() => {
            setAddingWallet(false);
            setOnboarding("start");
          }}
          onError={(cause) => setNotice(errorMessage(cause, t))}
        />
        {trustDialogs}
      </SafeAreaView>
    );
  }

  const displayedTrustDevice =
    profile.kind === "cryptape-trust"
      ? {
          id: profile.deviceId,
          name: profile.name,
          publicKey: profile.publicKey,
        }
      : undefined;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      {notice ? <Notice text={notice} onDismiss={() => setNotice(undefined)} /> : null}
      <View style={styles.body}>
        {screen === "home" ? (
          <HomeScreen
            signer={signerRef.current}
            network={network}
            profile={profile}
            wallets={walletState.wallets}
            onSelectWallet={(walletId) => {
              void selectWallet(walletId)
                .catch((cause: unknown) => setNotice(errorMessage(cause, t)));
            }}
            onNavigate={setScreen}
          />
        ) : null}
        {screen === "receive" ? (
          <ReceiveScreen signer={signerRef.current} onBack={() => setScreen("home")} />
        ) : null}
        {screen === "khie" ? (
          <KhieScreen
            state={sessionState}
            pairing={pairing}
            approval={approval}
            network={network}
            signer={signerRef.current}
            onScan={() => setScreen("scanner")}
            onPair={pairKhieEndpoint}
            onCancelPairing={cancelKhiePairing}
            onConnectRelay={(address) =>
              sessionRef.current?.connectRelay(address) ?? Promise.resolve(false)
            }
            onUnpair={() => sessionRef.current?.unpair() ?? Promise.resolve()}
            onRespond={(approved) =>
              approval && approvalQueue.respond(approval.id, approved)
            }
          />
        ) : null}
        {screen === "trust" && displayedTrustDevice ? (
          <TrustDeviceScreen
            device={displayedTrustDevice}
            onRefresh={refreshSelectedTrust}
            onGenerate={generateTrustKey}
            onImport={importTrustKey}
            onReset={resetTrustKey}
          />
        ) : null}
        {screen === "settings" ? (
          <SettingsScreen
            key={profile.id}
            backend={localBackend}
            network={network}
            profile={profile}
            wallets={walletState.wallets}
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
            onChangeNetwork={changeNetwork}
            onChangeBiometricUnlock={changeBiometricUnlock}
            onChangeMasterPassword={changeMasterPassword}
            onSelectWallet={selectWallet}
            onAddWallet={() => {
              setOnboarding("start");
              setAddingWallet(true);
            }}
            onRemoveWallet={async (walletId) => {
              const removed = walletState.wallets.find((wallet) => wallet.id === walletId);
              if (
                removed?.kind === "cryptape-trust" &&
                trustDevice?.id.toLowerCase() === removed.deviceId.toLowerCase()
              ) {
                await clearTrustConnection();
              }
              if (walletId === profile.id && sessionState.paired) {
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
        ) : null}
        {screen === "scanner" ? (
          <ScannerScreen
            onCancel={() => setScreen("khie")}
            onScanned={(value) => {
              setScreen("khie");
              void pairKhieEndpoint(value);
            }}
          />
        ) : null}
      </View>
      {screen !== "scanner" ? (
        <BottomBar
          current={screen}
          showTrust={profile.kind === "cryptape-trust"}
          onNavigate={setScreen}
        />
      ) : null}
      {trustDialogs}
      {khieNotificationPermissionDialog}
    </SafeAreaView>
  );
}

function LoadingScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <SafeAreaView
      style={[styles.safe, styles.center, { backgroundColor: theme.colors.background }]}
    >
      <ActivityIndicator size="large" />
      <Text variant="bodyLarge">{t("loadingWallet")}</Text>
    </SafeAreaView>
  );
}

function OnboardingScreen({
  mode,
  vault,
  hasMasterPassword,
  onUnlockMasterPassword,
  onMode,
  onComplete,
  onConnectTrust,
  onCancel,
  onError,
}: {
  mode: Onboarding;
  vault: SecureStoreWalletVault;
  hasMasterPassword: boolean;
  onUnlockMasterPassword: () => Promise<string>;
  onMode: (mode: Onboarding) => void;
  onComplete: (state: WalletState) => Promise<void> | void;
  onConnectTrust: (device: TrustDevice) => Promise<void>;
  onCancel?: () => void;
  onError: (cause: unknown) => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const [generatedMnemonic, setGeneratedMnemonic] = useState("");
  const [restoreMnemonic, setRestoreMnemonic] = useState("");
  const [challenges, setChallenges] = useState<MnemonicChallenge[]>([]);
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [challengeError, setChallengeError] = useState(false);
  const [passwordMnemonic, setPasswordMnemonic] = useState("");
  const [passwordSource, setPasswordSource] = useState<"create" | "restore">(
    "create",
  );
  const [newWalletPassword, setNewWalletPassword] = useState("");
  const [confirmWalletPassword, setConfirmWalletPassword] = useState("");
  const [enableBiometricUnlock, setEnableBiometricUnlock] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === "start" && !onCancel) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (mode === "confirm") {
        onMode("create");
      } else if (mode === "password") {
        onMode(passwordSource);
      } else if (mode !== "start") {
        onMode("start");
      } else {
        onCancel?.();
      }
      return true;
    });
    return () => subscription.remove();
  }, [mode, onCancel, onMode, passwordSource]);

  const beginCreate = async () => {
    setBusy(true);
    try {
      setGeneratedMnemonic(await generateMnemonic());
      onMode("create");
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  };

  const beginPasswordSetup = async (
    value: string,
    source: "create" | "restore",
  ) => {
    try {
      const mnemonic = assertValidMnemonic(value);
      if (hasMasterPassword) {
        setBusy(true);
        const passwordCredential = await onUnlockMasterPassword();
        await onComplete(await persistWallet(vault, mnemonic, passwordCredential));
        return;
      }
      setPasswordMnemonic(mnemonic);
      setPasswordSource(source);
      setNewWalletPassword("");
      setConfirmWalletPassword("");
      setEnableBiometricUnlock(false);
      onMode("password");
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await onComplete(
        await persistFirstMnemonicWallet(
          vault,
          passwordMnemonic,
          newWalletPassword,
          enableBiometricUnlock,
        ),
      );
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  };

  const beginConfirmation = () => {
    setChallenges(createMnemonicChallenges(generatedMnemonic));
    setChallengeIndex(0);
    setChallengeError(false);
    onMode("confirm");
  };

  const answerChallenge = (answer: string) => {
    const challenge = challenges[challengeIndex];
    if (!challenge || busy) return;
    if (answer === challenge.answer) {
      if (challengeIndex + 1 < challenges.length) {
        setChallengeIndex(challengeIndex + 1);
        setChallengeError(false);
      } else {
        void beginPasswordSetup(generatedMnemonic, "create");
      }
      return;
    }
    setChallengeError(true);
  };

  if (mode === "start") {
    if (!onCancel) {
      return (
        <View style={styles.onboardingStart}>
          <View style={styles.onboardingContent}>
            <Icon source="wallet" size={64} color={theme.colors.primary} />
            <Text variant="displaySmall">Khie Wallet</Text>
            <Text variant="bodyLarge" style={styles.centerText}>{t("tagline")}</Text>
            <PrimaryButton label={t("createWallet")} onPress={() => void beginCreate()} disabled={busy} />
            <SecondaryButton label={t("restoreWallet")} onPress={() => onMode("restore")} />
            <LinkButton label={t("connectTrustWallet")} onPress={() => onMode("trust")} />
            <HelperText type="error" visible style={styles.centerText}>
              {t("developmentWarning")}
            </HelperText>
          </View>
          <LanguageMenu />
        </View>
      );
    }
    return (
      <View style={[styles.page, styles.center]}>
        <BackButton onPress={onCancel} />
        <Icon source="wallet" size={64} color={theme.colors.primary} />
        <Text variant="displaySmall">{t("addWallet")}</Text>
        <PrimaryButton label={t("createWallet")} onPress={() => void beginCreate()} disabled={busy} />
        <SecondaryButton label={t("restoreWallet")} onPress={() => onMode("restore")} />
        <LinkButton label={t("connectTrustWallet")} onPress={() => onMode("trust")} />
      </View>
    );
  }

  if (mode === "trust") {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <BackButton onPress={() => onMode("start")} />
        <TrustWalletBanner />
        <Text variant="headlineMedium">{t("connectTrustWallet")}</Text>
        <View
          style={[
            styles.trustRiskNotice,
            { backgroundColor: theme.colors.surfaceVariant },
          ]}
        >
          <View style={styles.trustRiskNoticeHeader}>
            <Icon source="information-outline" size={24} color={theme.colors.primary} />
            <Text
              variant="titleMedium"
              style={[styles.flex, { color: theme.colors.onSurfaceVariant }]}
            >
              {t("trustRiskTitle")}
            </Text>
          </View>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {t("trustRiskDescription")}
          </Text>
          <PaperButton
            compact
            mode="text"
            icon="open-in-new"
            style={styles.trustRiskLink}
            textColor={theme.colors.primary}
            onPress={() =>
              void Linking.openURL("https://github.com/cryptape/trust-android").catch(
                () => undefined,
              )
            }
          >
            {t("trustOriginalRepository")}
          </PaperButton>
        </View>
        <Text variant="bodyMedium">{t("trustWalletScanHint")}</Text>
        <TrustWalletPicker onConnect={onConnectTrust} />
      </ScrollView>
    );
  }

  if (mode === "restore") {
    return (
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <BackButton onPress={() => onMode("start")} />
        <Text variant="headlineMedium">{t("restoreWallet")}</Text>
        <Text variant="bodyMedium">{t("enterMnemonic")}</Text>
        <WalletTextInput
          style={styles.mnemonicInput}
          multiline
          label={t("mnemonic")}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="word1 word2 …"
          value={restoreMnemonic}
          onChangeText={setRestoreMnemonic}
        />
        <PrimaryButton
          label={busy ? t("saving") : t("restore")}
          onPress={() => void beginPasswordSetup(restoreMnemonic, "restore")}
          disabled={busy}
        />
      </ScrollView>
    );
  }

  if (mode === "create") {
    const words = generatedMnemonic.split(" ");
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <BackButton onPress={() => onMode("start")} />
        <Text variant="headlineMedium">{t("backupMnemonic")}</Text>
        <HelperText type="error" visible>
          {t("backupWarning")}
        </HelperText>
        <View style={styles.words}>
          {words.map((word, index) => (
            <Chip key={`${word}-${index}`} compact mode="flat">
              {index + 1}. {word}
            </Chip>
          ))}
        </View>
        <PrimaryButton label={t("continueToVerification")} onPress={beginConfirmation} />
      </ScrollView>
    );
  }

  if (mode === "password") {
    const passwordTooShort =
      newWalletPassword.length > 0 &&
      [...newWalletPassword].length < MIN_WALLET_PASSWORD_LENGTH;
    const passwordsDoNotMatch =
      confirmWalletPassword.length > 0 &&
      confirmWalletPassword !== newWalletPassword;
    const biometricAvailable = vault.canUseBiometrics();
    return (
      <KeyboardAwareScrollView
        bottomOffset={16}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
      >
        <BackButton onPress={() => onMode(passwordSource)} />
        <Text variant="headlineMedium">{t("setWalletPassword")}</Text>
        <Text variant="bodyMedium">{t("walletPasswordDescription")}</Text>
        <WalletTextInput
          autoFocus
          label={t("walletPassword")}
          secureTextEntry
          value={newWalletPassword}
          onChangeText={setNewWalletPassword}
        />
        {passwordTooShort ? (
          <HelperText type="error" visible>
            {t("walletPasswordTooShort")}
          </HelperText>
        ) : null}
        <WalletTextInput
          label={t("confirmWalletPassword")}
          secureTextEntry
          returnKeyType="done"
          value={confirmWalletPassword}
          onChangeText={setConfirmWalletPassword}
          onSubmitEditing={() => {
            if (
              [...newWalletPassword].length >= MIN_WALLET_PASSWORD_LENGTH &&
              confirmWalletPassword === newWalletPassword &&
              !busy
            ) {
              void save();
            }
          }}
        />
        {passwordsDoNotMatch ? (
          <HelperText type="error" visible>
            {t("walletPasswordsDoNotMatch")}
          </HelperText>
        ) : null}
        <List.Item
          title={t("biometricUnlock")}
          description={({ color, fontSize }) => (
            <Text style={{ color, fontSize }}>
              {biometricAvailable
                ? t("biometricUnlockDescription")
                : t("biometricUnlockUnavailable")}
            </Text>
          )}
          left={(props) => (
            <List.Icon
              {...props}
              icon="fingerprint"
              style={[props.style, styles.listItemCenteredAccessory]}
            />
          )}
          right={(props) => (
            <View
              pointerEvents="none"
              style={[props.style, styles.listItemCenteredAccessory]}
            >
              <Switch
                disabled={!biometricAvailable}
                value={enableBiometricUnlock}
              />
            </View>
          )}
          onPress={() => {
            if (biometricAvailable) {
              setEnableBiometricUnlock((value) => !value);
            }
          }}
        />
        <PrimaryButton
          label={busy ? t("saving") : t("saveWallet")}
          disabled={
            busy ||
            [...newWalletPassword].length < MIN_WALLET_PASSWORD_LENGTH ||
            confirmWalletPassword !== newWalletPassword
          }
          onPress={() => void save()}
        />
      </KeyboardAwareScrollView>
    );
  }

  const challenge = challenges[challengeIndex];
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <BackButton onPress={() => onMode("create")} />
      <Text variant="headlineMedium">{t("verifyMnemonic")}</Text>
      <Text variant="labelLarge">
        {t("mnemonicQuestionProgress", {
          current: challengeIndex + 1,
          total: challenges.length || 2,
        })}
      </Text>
      <Text variant="bodyLarge">
        {t("selectMnemonicWord", { number: challenge?.position ?? 1 })}
      </Text>
      {challengeError ? (
        <HelperText type="error" visible>
          {t("incorrectMnemonicWord")}
        </HelperText>
      ) : null}
      {challenge?.options.map((option) => (
        <PaperButton
          key={option}
          mode="contained-tonal"
          disabled={busy}
          onPress={() => answerChallenge(option)}
        >
          {option}
        </PaperButton>
      ))}
      {busy ? <ActivityIndicator /> : null}
    </ScrollView>
  );
}

function HomeScreen({
  signer,
  network,
  profile,
  wallets,
  onSelectWallet,
  onNavigate,
}: {
  signer?: Signer;
  network: Network;
  profile: WalletProfile;
  wallets: WalletProfile[];
  onSelectWallet: (walletId: string) => void;
  onNavigate: (screen: Screen) => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [address, setAddress] = useState(() => t("addressGenerating"));
  const [balance, setBalance] = useState("—");
  const [refreshing, setRefreshing] = useState(false);
  const balanceParts = /^(-?\d+)(\.\d+)$/.exec(balance);
  const integerBalance = balanceParts?.[1] ?? balance;
  const fractionalBalance = balanceParts?.[2];
  const integerFontSize = Math.max(
    28,
    Math.min(45, (width - 136) / Math.max(integerBalance.length * 0.58, 1)),
  );

  const refresh = useCallback(async () => {
    if (!signer) return;
    setRefreshing(true);
    try {
      const [nextAddress, nextBalance] = await Promise.all([
        signer.getRecommendedAddress(),
        signer.getBalance(),
      ]);
      setAddress(nextAddress);
      setBalance(fixedPointToString(nextBalance));
    } catch {
      try {
        setAddress(await signer.getRecommendedAddress());
      } catch {
        setAddress(t("addressReadFailed"));
      }
      setBalance(t("readFailed"));
    } finally {
      setRefreshing(false);
    }
  }, [signer, t]);

  useEffect(() => void refresh(), [refresh, network]);

  const recommendedApps = [
    {
      name: "NervDAO",
      description: t("nervDaoDescription"),
      icon: "nervdao",
      url: "https://nervdao.com/",
    },
    {
      name: "Omiga",
      description: t("omigaDescription"),
      icon: "omiga",
      url: "https://omiga.io/",
    },
    {
      name: "CCC App",
      description: t("cccAppDescription"),
      icon: "ccc",
      url: "https://app.ckbccc.com/",
    },
  ] as const;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <WalletMenu
        wallets={wallets}
        selected={profile.id}
        onSelect={onSelectWallet}
      />
      {profile.kind === "cryptape-trust" && !signer ? (
        <PaperCard mode="elevated">
          <PaperCard.Title
            title="Cryptape Trust"
            subtitle={walletLabel(wallets, profile.id, t)}
            left={({ size }) => (
              <CryptapeIcon color={theme.colors.onSurfaceVariant} size={size} />
            )}
          />
          <PaperCard.Content>
            <Text variant="bodyMedium">{t("trustDeviceHasNoKey")}</Text>
          </PaperCard.Content>
          <PaperCard.Actions style={styles.cardActions}>
            <PaperButton
              mode="contained"
              icon="tune-variant"
              onPress={() => onNavigate("trust")}
            >
              {t("manageTrustDevice")}
            </PaperButton>
          </PaperCard.Actions>
        </PaperCard>
      ) : (
        <>
      <View style={styles.balanceBlock}>
        <Text variant="labelLarge">{network === "testnet" ? t("ckbTestnet") : t("ckbMainnet")}</Text>
        <View style={styles.balanceValue}>
          <View style={styles.balanceIntegerRow}>
            <View style={styles.balanceActionSpacer} />
            <View style={styles.balanceNumber}>
              <Text
                variant="displayMedium"
                numberOfLines={1}
                style={[
                  styles.balanceInteger,
                  { fontSize: integerFontSize, lineHeight: Math.round(integerFontSize * 1.16) },
                ]}
              >
                {integerBalance}
              </Text>
              {fractionalBalance ? (
                <Text
                  variant="titleLarge"
                  style={[styles.balanceFraction, { color: theme.colors.onSurfaceVariant }]}
                >
                  {fractionalBalance}
                </Text>
              ) : null}
            </View>
            <IconButton
              icon="refresh"
              loading={refreshing}
              disabled={refreshing}
              accessibilityLabel={t("refresh")}
              style={styles.balanceRefresh}
              onPress={() => void refresh()}
            />
          </View>
        </View>
        <Text variant="titleMedium">CKB</Text>
      </View>
      <PaperCard mode="elevated">
        <PaperCard.Title title={t("walletAddress")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="identifier" />} />
        <PaperCard.Content>
          <Text variant="bodyMedium" selectable style={styles.mono}>{address}</Text>
        </PaperCard.Content>
        <PaperCard.Actions style={styles.cardActions}>
          <PaperButton icon="qrcode" mode="contained" onPress={() => onNavigate("receive")}>
            {t("receive")}
          </PaperButton>
        </PaperCard.Actions>
      </PaperCard>
        </>
      )}
      <View style={styles.recommendedSection}>
        <Text variant="titleLarge">{t("recommendedApps")}</Text>
        <View style={styles.recommendedApps}>
          {recommendedApps.map((app) => (
            <InfoCard
              key={app.url}
              title={app.name}
              description={app.description}
              centerContent
              icon={({ color, size }) => (
                <RecommendedAppIcon name={app.icon} size={size} color={color} />
              )}
              showExternalLink
              onPress={() => void Linking.openURL(app.url).catch(() => undefined)}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function ReceiveScreen({ signer, onBack }: { signer?: Signer; onBack: () => void }) {
  const { t } = useI18n();
  const [address, setAddress] = useState("");
  useEffect(() => {
    void signer?.getRecommendedAddress().then(setAddress);
  }, [signer]);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <BackButton onPress={onBack} />
      <Text variant="headlineMedium">{t("receive")}</Text>
      <PaperCard mode="elevated">
        <PaperCard.Content style={styles.qrContent}>
          {address ? <QuietQrCode value={address} size={230} /> : <ActivityIndicator />}
          <Text variant="bodyMedium" selectable style={[styles.mono, styles.centerText]}>{address}</Text>
        </PaperCard.Content>
      </PaperCard>
    </ScrollView>
  );
}

function KhieScreen({
  state,
  pairing,
  approval,
  network,
  signer,
  onScan,
  onPair,
  onCancelPairing,
  onConnectRelay,
  onUnpair,
  onRespond,
}: {
  state: KhieProviderSessionState;
  pairing: boolean;
  approval?: ApprovalItem;
  network: Network;
  signer?: Signer;
  onScan: () => void;
  onPair: (endpoint: string) => Promise<boolean>;
  onCancelPairing: () => void;
  onConnectRelay: (address: string) => Promise<boolean>;
  onUnpair: () => Promise<void>;
  onRespond: (approved: boolean) => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const [endpoint, setEndpoint] = useState("");
  const [endpointCopied, setEndpointCopied] = useState(false);
  const endpointCopyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const approvalScrolledId = useRef<number | undefined>(undefined);
  const khieContentOffsetY = useRef(0);
  const [relayAddress, setRelayAddress] = useState(state.relayAddress);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const qrSize = Math.max(180, Math.min(420, width - 64));

  useEffect(() => setRelayAddress(state.relayAddress), [state.relayAddress]);

  useEffect(() => {
    if (!approval) {
      approvalScrolledId.current = undefined;
    }
  }, [approval]);

  const scrollToApproval = useCallback(
    (event: LayoutChangeEvent) => {
      if (!approval || approvalScrolledId.current === approval.id) return;
      approvalScrolledId.current = approval.id;
      const { y } = event.nativeEvent.layout;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          y: khieContentOffsetY.current + y,
          animated: true,
        });
      });
    },
    [approval],
  );

  useEffect(() => {
    setEndpointCopied(false);
    if (endpointCopyTimer.current) clearTimeout(endpointCopyTimer.current);
  }, [state.endpoint]);

  useEffect(
    () => () => {
      if (endpointCopyTimer.current) clearTimeout(endpointCopyTimer.current);
    },
    [],
  );

  const copyEndpoint = async () => {
    if (!state.endpoint) return;
    await Clipboard.setStringAsync(state.endpoint);
    setEndpointCopied(true);
    if (endpointCopyTimer.current) clearTimeout(endpointCopyTimer.current);
    endpointCopyTimer.current = setTimeout(() => setEndpointCopied(false), 1600);
  };

  const pair = async () => {
    if (await onPair(endpoint)) {
      setEndpoint("");
    }
  };

  const connectionPath = !state.remotePeer?.active
    ? t("inactive")
    : state.remotePeer.direct
      ? t("direct")
      : t("relayed");

  return (
    <KeyboardAwareScrollView
      ref={scrollRef}
      bottomOffset={16}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="headlineMedium">Khie</Text>
      <InfoCard
        title={t("khieIntroductionTitle")}
        description={t("khieIntroduction")}
        supportingText={t("khieNameMeaning")}
        icon={({ color, size }) => (
          <KhieIcon size={size} color={color} />
        )}
      />

      {pairing ? (
        <View style={styles.pairingProgress}>
          <ActivityIndicator size="large" />
          <Text variant="titleLarge">{t("pairingWithKhie")}</Text>
          <PaperButton mode="text" onPress={onCancelPairing}>{t("cancel")}</PaperButton>
        </View>
      ) : state.paired ? (
        <View
          style={styles.khieContent}
          onLayout={(event) => {
            khieContentOffsetY.current = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.peerOverview}>
            {state.remotePeer ? (
              <>
                <Chip compact>{connectionPath}</Chip>
                <View style={styles.flex}>
                  <Text variant="titleMedium" numberOfLines={1}>
                    {state.remotePeer.name ?? t("unknown")}
                  </Text>
                  <Text variant="bodySmall" numberOfLines={1}>
                    {state.remotePeer.agentVersion ?? t("unknownAgent")}
                  </Text>
                </View>
              </>
            ) : (
              <Text variant="bodyMedium" style={styles.flex}>
                {t("loadingRemotePeerDetails")}
              </Text>
            )}
            <PaperButton
              compact
              textColor={theme.colors.error}
              onPress={() => void onUnpair()}
            >
              {t("unpair")}
            </PaperButton>
          </View>
          {state.remotePeer ? (
            <View style={styles.peerMetadata}>
              <View style={styles.metadataBlock}>
                <Text variant="labelMedium">Peer ID</Text>
                <Text
                  variant="bodySmall"
                  selectable
                  numberOfLines={2}
                  style={styles.mono}
                >
                  {state.remotePeer.id}
                </Text>
              </View>
              <View style={styles.metadataBlock}>
                <Text variant="labelMedium">{t("lastSeen")}</Text>
                <Text variant="bodySmall" style={styles.mono}>
                  {state.remotePeer.active ? (
                    t("active")
                  ) : state.remotePeer.lastSeenAt === undefined ? (
                    t("notAvailable")
                  ) : (
                    <InactiveLastSeen timestamp={state.remotePeer.lastSeenAt} />
                  )}
                </Text>
              </View>
            </View>
          ) : null}
          <Divider />
          <ApprovalPanel
            item={approval}
            network={network}
            signer={signer}
            onRespond={onRespond}
            onLayout={scrollToApproval}
          />
        </View>
      ) : (
        <View style={styles.khieContent}>
          <View style={styles.khieMethod}>
            <Text variant="titleSmall">{t("scanConnectorCode")}</Text>
            <PaperButton mode="contained" icon="qrcode-scan" onPress={onScan}>
              {t("scanConnectorCode")}
            </PaperButton>
            <FloatingLabelTextInput
              label={t("khieEndpoint")}
              placeholder={t("pastePairingCode")}
              autoCapitalize="none"
              autoCorrect={false}
              value={endpoint}
              onChangeText={setEndpoint}
              right={
                <PaperTextInput.Icon
                  icon="arrow-right"
                  disabled={!endpoint.trim()}
                  onPress={() => void pair()}
                />
              }
            />
          </View>
          {state.error ? (
            <View
              style={[
                styles.khieErrorNotice,
                { backgroundColor: theme.colors.surfaceVariant },
              ]}
            >
              <Icon
                source="information-outline"
                color={theme.colors.onSurfaceVariant}
                size={24}
              />
              <View style={[styles.flex, styles.khieErrorCopy]}>
                <Text
                  variant="labelLarge"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  {state.error.kind === "incompatible-pairing-code"
                    ? t("incompatiblePairingCode")
                    : t("operationFailed")}
                </Text>
                <Text
                  variant="bodyMedium"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  {formatKhieError(state.error, t)}
                </Text>
              </View>
            </View>
          ) : null}
          <View style={styles.orDivider}>
            <Divider style={styles.flex} />
            <Text variant="labelMedium">{t("or")}</Text>
            <Divider style={styles.flex} />
          </View>
          <View style={styles.khieMethod}>
            <Text variant="titleSmall">{t("letConnectorScanThis")}</Text>
            {state.endpoint ? (
              <>
                <QuietQrCode value={state.endpoint} size={qrSize} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    endpointCopied
                      ? t("khieEndpointCopied")
                      : t("copyKhieEndpoint")
                  }
                  accessibilityLiveRegion="polite"
                  onPress={() => void copyEndpoint()}
                  style={({ pressed }) => [
                    styles.endpointCopyRow,
                    pressed && styles.endpointCopyRowPressed,
                  ]}
                >
                  <Text
                    variant="labelSmall"
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.mono, styles.endpointCopyText]}
                  >
                    {state.endpoint}
                  </Text>
                  <Icon
                    source={endpointCopied ? "check" : "content-copy"}
                    size={18}
                    color={theme.colors.onSurfaceVariant}
                  />
                </Pressable>
              </>
            ) : (
              <View style={[styles.qrPlaceholder, { height: qrSize + 24 }]}>
                <ActivityIndicator />
                <Text variant="bodyMedium">
                  {state.relayConnected
                    ? t("preparingPairingCode")
                    : t("connectingToRelay")}
                </Text>
                {state.ready && !state.relayConnected ? (
                  <PaperButton
                    icon="refresh"
                    loading={state.relayConnecting}
                    disabled={state.relayConnecting}
                    onPress={() => void onConnectRelay(state.relayAddress)}
                  >
                    {t("retryRelay")}
                  </PaperButton>
                ) : null}
              </View>
            )}
          </View>
          <PaperButton
            compact
            mode="text"
            icon={advancedSettingsOpen ? "chevron-up" : "chevron-down"}
            onPress={() => setAdvancedSettingsOpen((open) => !open)}
            style={styles.advancedSettingsToggle}
          >
            {t("advancedSettings")}
          </PaperButton>
          {advancedSettingsOpen ? (
            <View style={styles.relaySettings}>
              <FloatingLabelTextInput
                label={t("relayMultiaddr")}
                autoCapitalize="none"
                autoCorrect={false}
                value={relayAddress}
                onChangeText={setRelayAddress}
                returnKeyType="go"
                onSubmitEditing={() => void onConnectRelay(relayAddress)}
              />
              <PaperButton
                mode="contained-tonal"
                icon="connection"
                loading={state.relayConnecting}
                disabled={state.relayConnecting || !state.ready || !relayAddress.trim()}
                onPress={() => void onConnectRelay(relayAddress)}
              >
                {state.relayConnecting
                  ? t("connecting")
                  : state.relayConnected
                    ? t("reconnect")
                    : t("connectRelay")}
              </PaperButton>
            </View>
          ) : null}
        </View>
      )}

    </KeyboardAwareScrollView>
  );
}

function ScannerScreen({ onCancel, onScanned }: { onCancel: () => void; onScanned: (value: string) => void }) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        onCancel();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onCancel]);

  if (!permission) {
    return <View style={[styles.page, styles.center]}><ActivityIndicator /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={styles.page}>
        <Portal>
          <Dialog visible onDismiss={onCancel}>
            <Dialog.Icon icon="camera" />
            <Dialog.Title style={styles.centerText}>
              {t("cameraPermissionRequired")}
            </Dialog.Title>
            <Dialog.Content>
              <Text variant="bodyMedium">{t("cameraPermissionReason")}</Text>
            </Dialog.Content>
            <Dialog.Actions style={styles.dialogActions}>
              <PaperButton
                contentStyle={styles.extraHorizontalButtonPadding}
                onPress={onCancel}
              >
                {t("back")}
              </PaperButton>
              <PaperButton
                mode="contained"
                contentStyle={styles.extraHorizontalButtonPadding}
                onPress={() => {
                  if (permission.canAskAgain) {
                    void requestPermission();
                  } else {
                    void Linking.openSettings();
                  }
                }}
              >
                {permission.canAskAgain ? t("allowCamera") : t("openSettings")}
              </PaperButton>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      </View>
    );
  }
  return (
    <View style={styles.scanner}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (!scanned.current) {
            scanned.current = true;
            onScanned(data);
          }
        }}
      />
      <View style={styles.scanFooter}>
        <Text variant="titleMedium" style={styles.scanText}>{t("scanConnectorCode")}</Text>
        <PaperButton mode="contained-tonal" icon="close" onPress={onCancel}>{t("cancelScan")}</PaperButton>
      </View>
    </View>
  );
}

function SettingsScreen({
  backend,
  network,
  profile,
  wallets,
  rpcUrls,
  themePreference,
  updateSettings,
  checkingForUpdates,
  currentVersion,
  buildCommit,
  appArchitecture,
  updateAvailable,
  updateAsset,
  focusAppInformation,
  biometricAvailable,
  biometricUnlock,
  masterPasswordSet,
  onChangeNetwork,
  onChangeBiometricUnlock,
  onChangeMasterPassword,
  onSelectWallet,
  onAddWallet,
  onRemoveWallet,
  onSaveRpcUrls,
  onChangeThemePreference,
  onChangeAutomaticUpdateChecks,
  onCheckForUpdates,
  onDownloadUpdate,
  onAppInformationFocused,
}: {
  backend?: LocalMnemonicSigningBackend;
  network: Network;
  profile: WalletProfile;
  wallets: WalletProfile[];
  rpcUrls: NetworkRpcUrls;
  themePreference: ThemePreference;
  updateSettings: UpdateSettings;
  checkingForUpdates: boolean;
  currentVersion: string;
  buildCommit: string;
  appArchitecture: string;
  updateAvailable: boolean;
  updateAsset?: ReleaseAsset;
  focusAppInformation: boolean;
  biometricAvailable: boolean;
  biometricUnlock: boolean;
  masterPasswordSet: boolean;
  onChangeNetwork: (network: Network) => void;
  onChangeBiometricUnlock: (enabled: boolean) => Promise<void>;
  onChangeMasterPassword: (
    oldPassword: string,
    newPassword: string,
  ) => Promise<void>;
  onSelectWallet: (walletId: string) => Promise<void>;
  onAddWallet: () => void;
  onRemoveWallet: (walletId: string) => Promise<void>;
  onSaveRpcUrls: (urls: NetworkRpcUrls) => Promise<void>;
  onChangeThemePreference: (preference: ThemePreference) => Promise<void>;
  onChangeAutomaticUpdateChecks: (enabled: boolean) => Promise<void>;
  onCheckForUpdates: () => Promise<void> | void;
  onDownloadUpdate: () => Promise<void>;
  onAppInformationFocused: () => void;
}) {
  const { t } = useI18n();
  const appDialog = useAppDialog();
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const [secret, setSecret] = useState<{ label: string; value: string }>();
  const [rpcDraft, setRpcDraft] = useState<NetworkRpcUrls>(rpcUrls);
  const [savingRpcUrls, setSavingRpcUrls] = useState(false);
  const [updatingBiometrics, setUpdatingBiometrics] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [walletAddresses, setWalletAddresses] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!focusAppInformation) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
      onAppInformationFocused();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAppInformation, onAppInformationFocused]);
  useEffect(() => setRpcDraft(rpcUrls), [rpcUrls]);
  useEffect(() => {
    let active = true;
    setWalletAddresses({});
    const client = clientForNetwork(network, rpcUrls[network]);
    for (const wallet of wallets) {
      if (wallet.kind !== "mnemonic") continue;
      void new SignerCkbPublicKey(client, wallet.publicKey)
        .getRecommendedAddress()
        .then((address) => {
          if (!active) return;
          setWalletAddresses((current) => ({ ...current, [wallet.id]: address }));
        })
        .catch(() => {
          if (!active) return;
          setWalletAddresses((current) => ({
            ...current,
            [wallet.id]: t("addressReadFailed"),
          }));
        });
    }
    return () => {
      active = false;
    };
  }, [network, rpcUrls, t, wallets]);
  const testnetRpcValid = isRpcUrl(rpcDraft.testnet);
  const mainnetRpcValid = isRpcUrl(rpcDraft.mainnet);
  const rpcUrlsChanged =
    rpcDraft.testnet.trim() !== rpcUrls.testnet ||
    rpcDraft.mainnet.trim() !== rpcUrls.mainnet;
  const applyRpcUrls = async (next: NetworkRpcUrls) => {
    setSavingRpcUrls(true);
    try {
      await onSaveRpcUrls(next);
    } catch (cause) {
      appDialog.show(t("unableToSave"), errorMessage(cause, t));
    } finally {
      setSavingRpcUrls(false);
    }
  };
  const toggleBiometricUnlock = () => {
    if (updatingBiometrics || !biometricAvailable) return;
    setUpdatingBiometrics(true);
    void onChangeBiometricUnlock(!biometricUnlock)
      .catch((cause: unknown) =>
        appDialog.show(t("unableToSave"), errorMessage(cause, t)),
      )
      .finally(() => setUpdatingBiometrics(false));
  };
  const reveal = async (kind: "mnemonic" | "privateKey") => {
    if (!backend) return;
    try {
      setSecret({
        label: kind === "mnemonic" ? t("mnemonic") : t("privateKey"),
        value: kind === "mnemonic" ? await backend.exportMnemonic() : await backend.exportPrivateKey(),
      });
    } catch (cause) {
      appDialog.show(t("unableToDisplay"), errorMessage(cause, t));
    }
  };
  const confirmRemove = (wallet: WalletProfile) => {
    appDialog.confirm({
      title: t("deleteWalletTitle", {
        wallet: walletLabel(wallets, wallet.id, t),
      }),
      message: t(
        wallet.kind === "cryptape-trust"
          ? "removeTrustWalletDescription"
          : "deleteWalletDescription",
      ),
      cancelLabel: t("cancel"),
      confirmLabel: t("delete"),
      destructive: true,
      onConfirm: () => {
        void onRemoveWallet(wallet.id).catch((cause: unknown) =>
          appDialog.show(t("unableToDeleteWallet"), errorMessage(cause, t)),
        );
      },
    });
  };
  return (
    <>
      <KeyboardAwareScrollView
        ref={scrollRef}
        bottomOffset={16}
        contentContainerStyle={[styles.page, styles.settingsPage]}
        keyboardShouldPersistTaps="handled"
      >
      <Text variant="headlineMedium">{t("settingsAndExport")}</Text>
      <PaperCard mode="elevated">
        <PaperCard.Title title={t("wallets")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="wallet" />} />
        <PaperCard.Content style={styles.walletListContent}>
          {wallets.map((wallet) => {
            const selected = wallet.id === profile.id;
            const walletDetail =
              wallet.kind === "cryptape-trust"
                ? wallet.deviceId
                : walletAddresses[wallet.id] ?? t("addressGenerating");
            return (
              <List.Item
                key={wallet.id}
                style={styles.walletListItem}
                title={walletLabel(wallets, wallet.id, t)}
                description={
                  selected
                    ? `${t("current")} · ${walletDetail}`
                    : walletDetail
                }
                descriptionEllipsizeMode="middle"
                descriptionNumberOfLines={1}
                left={(props) => (
                  <List.Icon {...props} icon={selected ? "wallet" : "wallet-outline"} />
                )}
                right={(props) => (
                  <IconButton
                    icon="delete-outline"
                    accessibilityLabel={t("delete")}
                    style={[props.style, styles.walletDeleteButton]}
                    onPress={() => confirmRemove(wallet)}
                  />
                )}
                onPress={() => {
                  if (!selected) {
                    void onSelectWallet(wallet.id).catch((cause: unknown) =>
                      appDialog.show(
                        t("unableToSwitchWallet"),
                        errorMessage(cause, t),
                      ),
                    );
                  }
                }}
              />
            );
          })}
        </PaperCard.Content>
        <PaperCard.Actions style={styles.cardActions}>
          <PaperButton mode="contained" icon="plus" onPress={onAddWallet}>
            {t("addWallet")}
          </PaperButton>
        </PaperCard.Actions>
      </PaperCard>
      <PaperCard mode="elevated">
          <PaperCard.Title
            title={t("appearance")}
            leftStyle={styles.cardTitleLeft}
            left={(props) => <Icon {...props} source="theme-light-dark" />}
        />
        <PaperCard.Content>
          <SegmentedButtons
            value={themePreference}
            onValueChange={(value) => {
              void onChangeThemePreference(value as ThemePreference).catch((cause) =>
                appDialog.show(t("unableToSave"), errorMessage(cause, t)),
              );
            }}
            buttons={[
              { value: "system", label: t("systemTheme"), showSelectedCheck: false },
              { value: "light", label: t("lightTheme"), showSelectedCheck: false },
              { value: "dark", label: t("darkTheme"), showSelectedCheck: false },
            ]}
          />
        </PaperCard.Content>
      </PaperCard>
      {masterPasswordSet ? (
        <PaperCard mode="elevated">
          <PaperCard.Title
            title={t("security")}
            leftStyle={styles.cardTitleLeft}
            left={(props) => <Icon {...props} source="shield-lock" />}
          />
          <PaperCard.Content>
            <List.Item
              title={t("biometricUnlock")}
              description={({ color, fontSize }) => (
                <Text style={{ color, fontSize }}>
                  {biometricAvailable
                    ? t("biometricUnlockDescription")
                    : t("biometricUnlockUnavailable")}
                </Text>
              )}
              left={(props) => (
                <List.Icon
                  {...props}
                  icon="fingerprint"
                  style={[props.style, styles.listItemCenteredAccessory]}
                />
              )}
              right={(props) => (
                <View
                  pointerEvents="none"
                  style={[props.style, styles.listItemCenteredAccessory]}
                >
                  <Switch
                    disabled={updatingBiometrics || !biometricAvailable}
                    value={biometricUnlock}
                  />
                </View>
              )}
              onPress={() => {
                toggleBiometricUnlock();
              }}
            />
          </PaperCard.Content>
          <PaperCard.Actions style={styles.cardActions}>
            <PaperButton
              mode="contained"
              icon="key-change"
              onPress={() => setChangePasswordOpen(true)}
            >
              {t("changeMasterPassword")}
            </PaperButton>
          </PaperCard.Actions>
        </PaperCard>
      ) : null}
      <PaperCard mode="elevated">
        <PaperCard.Title title={t("language")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="translate" />} />
        <PaperCard.Content>
          <LanguageMenu />
        </PaperCard.Content>
      </PaperCard>
      <PaperCard mode="elevated">
        <PaperCard.Title title={t("network")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="web" />} />
        <PaperCard.Content>
          <NetworkSwitch value={network} onChange={onChangeNetwork} />
        </PaperCard.Content>
      </PaperCard>
      <PaperCard mode="elevated">
        <PaperCard.Title
          title={t("networkRpc")}
          leftStyle={styles.cardTitleLeft}
          left={(props) => <Icon {...props} source="server-network" />}
        />
        <PaperCard.Content>
          <WalletTextInput
            label={t("testnetRpcUrl")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={rpcDraft.testnet}
            error={!testnetRpcValid}
            onChangeText={(testnet) => setRpcDraft((current) => ({ ...current, testnet }))}
          />
          <HelperText type="error" visible={!testnetRpcValid}>
            {t("invalidRpcUrl")}
          </HelperText>
          <WalletTextInput
            label={t("mainnetRpcUrl")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={rpcDraft.mainnet}
            error={!mainnetRpcValid}
            onChangeText={(mainnet) => setRpcDraft((current) => ({ ...current, mainnet }))}
          />
          <HelperText type="error" visible={!mainnetRpcValid}>
            {t("invalidRpcUrl")}
          </HelperText>
        </PaperCard.Content>
        <PaperCard.Actions style={styles.cardActions}>
          <PaperButton
            mode="text"
            disabled={savingRpcUrls}
            onPress={() => void applyRpcUrls({ ...DEFAULT_NETWORK_RPC_URLS })}
          >
            {t("restoreDefaults")}
          </PaperButton>
          <PaperButton
            mode="contained"
            loading={savingRpcUrls}
            disabled={
              savingRpcUrls || !rpcUrlsChanged || !testnetRpcValid || !mainnetRpcValid
            }
            onPress={() => void applyRpcUrls(rpcDraft)}
          >
            {t("save")}
          </PaperButton>
        </PaperCard.Actions>
      </PaperCard>
      {profile.kind === "mnemonic" && backend ? (
        <PaperCard mode="elevated">
      <PaperCard.Title title={t("accountInformation")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="account-key" />} />
          <PaperCard.Content style={styles.cardContent}>
            <View style={styles.metadataBlock}>
              <Text variant="labelMedium">{t("derivationPath")}</Text>
              <Text variant="bodyMedium" selectable style={styles.mono}>{profile.derivationPath}</Text>
            </View>
            <Divider />
            <View style={styles.metadataBlock}>
              <Text variant="labelMedium">{t("publicKey")}</Text>
              <Text variant="bodySmall" selectable style={styles.mono}>{profile.publicKey}</Text>
            </View>
          </PaperCard.Content>
          <PaperCard.Actions style={styles.cardActions}>
            <PaperButton mode="text" icon="eye-lock" onPress={() => void reveal("privateKey")}>{t("viewPrivateKey")}</PaperButton>
            <PaperButton mode="contained" icon="eye-lock" onPress={() => void reveal("mnemonic")}>{t("viewMnemonic")}</PaperButton>
          </PaperCard.Actions>
        </PaperCard>
      ) : null}
      {profile.kind === "mnemonic" && secret ? (
        <PaperCard mode="contained">
        <PaperCard.Title title={secret.label} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="shield-key" />} />
          <PaperCard.Content>
            <Text variant="bodyMedium" selectable style={styles.mono}>{secret.value}</Text>
          </PaperCard.Content>
          <PaperCard.Actions style={styles.cardActions}>
            <PaperButton mode="text" icon="eye-off" onPress={() => setSecret(undefined)}>{t("hide")}</PaperButton>
          </PaperCard.Actions>
        </PaperCard>
      ) : null}
      {profile.kind === "mnemonic" ? (
        <HelperText type="error" visible>
          {t("exportWarning")}
        </HelperText>
      ) : null}
      <PaperCard mode="elevated">
        <PaperCard.Title
          title={t("appInformation")}
          leftStyle={styles.cardTitleLeft}
          left={(props) => <Icon {...props} source="information-outline" />}
        />
        <PaperCard.Content style={styles.cardContent}>
          <List.Item
            style={styles.appInformationLink}
            title={t("githubRepository")}
            description={GITHUB_REPOSITORY_URL}
            descriptionNumberOfLines={1}
            descriptionEllipsizeMode="middle"
            left={(props) => <List.Icon {...props} icon="github" />}
            right={(props) => <List.Icon {...props} icon="open-in-new" />}
            onPress={() => void Linking.openURL(GITHUB_REPOSITORY_URL)}
          />
          <Divider />
          <AppInformationRow
            label={t("currentVersion")}
            value={
              currentVersion.startsWith("v") ? currentVersion : `v${currentVersion}`
            }
          />
          <AppInformationRow
            label={t("latestVersion")}
            value={
              checkingForUpdates
                ? t("checkingForUpdates")
                : updateSettings.latestRelease?.tagName ?? t("notChecked")
            }
          />
          <AppInformationRow
            label={t("buildCommit")}
            value={buildCommit}
            mono
          />
          <AppInformationRow
            label={t("appArchitecture")}
            value={appArchitecture || t("unknown")}
          />
          <AppInformationRow
            label={t("lastChecked")}
            value={
              updateSettings.lastCheckedAt
                ? new Date(updateSettings.lastCheckedAt).toLocaleString()
                : t("notChecked")
            }
          />
          {updateSettings.latestRelease ? (
            <View style={styles.updateStatus}>
              <Icon
                source={updateAvailable ? "arrow-up-circle-outline" : "check-circle-outline"}
                size={20}
              />
              <Text variant="bodyMedium" style={styles.updateStatusText}>
                {updateAvailable
                  ? t("updateAvailableStatus", {
                      version: updateSettings.latestRelease.tagName,
                    })
                  : t("appIsUpToDate")}
              </Text>
            </View>
          ) : null}
          {updateAvailable && updateAsset ? (
            <Text variant="bodySmall" selectable style={styles.mono}>
              {updateAsset.name}
            </Text>
          ) : null}
          <Divider />
          <List.Item
            style={styles.appInformationSwitch}
            title={t("automaticUpdateChecks")}
            right={() => (
              <View pointerEvents="none">
                <Switch value={updateSettings.automaticChecks} />
              </View>
            )}
            onPress={() => {
              void onChangeAutomaticUpdateChecks(
                !updateSettings.automaticChecks,
              ).catch((cause) =>
                appDialog.show(t("unableToSave"), errorMessage(cause, t)),
              );
            }}
          />
        </PaperCard.Content>
        <PaperCard.Actions style={styles.cardActions}>
          <PaperButton
            mode="text"
            icon="refresh"
            loading={checkingForUpdates}
            disabled={checkingForUpdates}
            onPress={() => void onCheckForUpdates()}
          >
            {t("checkForUpdates")}
          </PaperButton>
          <PaperButton
            mode="contained"
            icon="download"
            disabled={!updateAvailable}
            onPress={() => void onDownloadUpdate()}
          >
            {t("downloadUpdate")}
          </PaperButton>
        </PaperCard.Actions>
      </PaperCard>
      </KeyboardAwareScrollView>
      <ChangeMasterPasswordDialog
        visible={changePasswordOpen}
        onDismiss={() => setChangePasswordOpen(false)}
        onSubmit={onChangeMasterPassword}
      />
    </>
  );
}

function ChangeMasterPasswordDialog({
  visible,
  onDismiss,
  onSubmit,
}: {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (oldPassword: string, newPassword: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!visible) {
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(undefined);
    }
  }, [visible]);

  const newPasswordTooShort =
    newPassword.length > 0 &&
    [...newPassword].length < MIN_WALLET_PASSWORD_LENGTH;
  const passwordsDoNotMatch =
    confirmPassword.length > 0 && confirmPassword !== newPassword;
  const valid =
    oldPassword.length > 0 &&
    [...newPassword].length >= MIN_WALLET_PASSWORD_LENGTH &&
    confirmPassword === newPassword;

  const submit = async () => {
    if (!valid || changing) return;
    setChanging(true);
    setError(undefined);
    try {
      await onSubmit(oldPassword, newPassword);
      onDismiss();
      void KeyboardController.dismiss({ animated: true });
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setChanging(false);
    }
  };

  return (
    <Portal>
      <KeyboardAvoidingView
        behavior="height"
        pointerEvents="box-none"
        style={styles.keyboardDialogLayer}
      >
        <Dialog visible={visible} dismissable={false} style={styles.keyboardDialog}>
          <Dialog.Title>{t("changeMasterPassword")}</Dialog.Title>
          <KeyboardDialogContent>
            <WalletTextInput
              autoFocus
              label={t("currentWalletPassword")}
              secureTextEntry
              value={oldPassword}
              onChangeText={(value) => {
                setOldPassword(value);
                setError(undefined);
              }}
            />
            <WalletTextInput
              label={t("newWalletPassword")}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />
            {newPasswordTooShort ? (
              <HelperText type="error" visible>
                {t("walletPasswordTooShort")}
              </HelperText>
            ) : null}
            <WalletTextInput
              label={t("confirmWalletPassword")}
              returnKeyType="done"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              onSubmitEditing={() => void submit()}
            />
            {passwordsDoNotMatch ? (
              <HelperText type="error" visible>
                {t("walletPasswordsDoNotMatch")}
              </HelperText>
            ) : null}
            {error ? (
              <HelperText type="error" visible>
                {error}
              </HelperText>
            ) : null}
          </KeyboardDialogContent>
          <Dialog.Actions style={styles.dialogActions}>
            <PaperButton
              contentStyle={styles.extraHorizontalButtonPadding}
              disabled={changing}
              onPress={() => {
                onDismiss();
                void KeyboardController.dismiss({ animated: true });
              }}
            >
              {t("cancel")}
            </PaperButton>
            <PaperButton
              mode="contained"
              contentStyle={styles.extraHorizontalButtonPadding}
              loading={changing}
              disabled={!valid || changing}
              onPress={() => void submit()}
            >
              {t("changePassword")}
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
      </KeyboardAvoidingView>
    </Portal>
  );
}

function AppInformationRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.appInformationRow}>
      <Text variant="labelMedium" style={styles.appInformationLabel}>
        {label}
      </Text>
      <Text
        variant="bodyMedium"
        selectable
        style={[styles.appInformationValue, mono && styles.mono]}
      >
        {value}
      </Text>
    </View>
  );
}

function TrustWalletPicker({
  onConnect,
}: {
  onConnect: (device: TrustDevice) => Promise<void>;
}) {
  const { t } = useI18n();
  const appDialog = useAppDialog();
  const { show: showTrustBluetoothSetupError } = useTrustBluetoothSetup();
  const [devices, setDevices] = useState<TrustDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string>();
  const supported = isTrustSupported();
  const compactDeviceLayout = useWindowDimensions().width < 400;

  const scan = async () => {
    setScanning(true);
    setDevices([]);
    try {
      setDevices(await scanForTrustDevices());
    } catch (cause) {
      if (!showTrustBluetoothSetupError(cause)) {
        appDialog.show(
          t("trustWalletConnectionFailed"),
          errorMessage(cause, t),
        );
      }
    } finally {
      setScanning(false);
    }
  };

  const connect = async (device: TrustDevice) => {
    setConnectingId(device.id);
    try {
      await onConnect(device);
      setDevices([]);
    } catch (cause) {
      appDialog.show(
        t("trustWalletConnectionFailed"),
        errorMessage(cause, t),
      );
    } finally {
      setConnectingId(undefined);
    }
  };

  return (
    <View style={styles.trustPicker}>
      {!supported ? (
        <Text variant="bodyMedium">{t("trustWalletAndroidBuildOnly")}</Text>
      ) : null}
      {devices.map((device) => (
        <View key={device.id} style={styles.trustDeviceResult}>
          <List.Item
            title={device.name}
            description={device.id}
            left={(props) => <List.Icon {...props} icon="memory" />}
            right={
              compactDeviceLayout
                ? undefined
                : (props) => (
                    <PaperButton
                      mode="contained-tonal"
                      style={props.style}
                      contentStyle={styles.extraHorizontalButtonPadding}
                      loading={connectingId === device.id}
                      disabled={Boolean(connectingId)}
                      onPress={() => void connect(device)}
                    >
                      {t("connect")}
                    </PaperButton>
                  )
            }
          />
          {compactDeviceLayout ? (
            <PaperButton
              mode="contained-tonal"
              style={styles.trustDeviceConnectCompact}
              contentStyle={styles.extraHorizontalButtonPadding}
              loading={connectingId === device.id}
              disabled={Boolean(connectingId)}
              onPress={() => void connect(device)}
            >
              {t("connect")}
            </PaperButton>
          ) : null}
        </View>
      ))}
      <View style={styles.trustPickerActions}>
        <PaperButton
          mode="contained"
          icon="bluetooth"
          loading={scanning}
          disabled={!supported || scanning || Boolean(connectingId)}
          onPress={() => void scan()}
        >
          {t("scanTrustWallets")}
        </PaperButton>
      </View>
    </View>
  );
}

function TrustWalletBanner() {
  const { t } = useI18n();
  const theme = useTheme();

  return (
    <ImageBackground
      accessibilityLabel={t("trustWallet")}
      imageStyle={styles.trustBannerImage}
      resizeMode="cover"
      source={require("./assets/cryptape-trust-device-banner.jpg")}
      style={styles.trustBanner}
    >
      <View
        style={[
          styles.trustBannerTint,
          {
            backgroundColor: theme.dark
              ? "rgba(0, 35, 33, 0.30)"
              : "rgba(0, 96, 84, 0.12)",
          },
        ]}
      />
    </ImageBackground>
  );
}

function TrustDeviceScreen({
  device,
  onRefresh,
  onGenerate,
  onImport,
  onReset,
}: {
  device: ConnectedTrustDevice;
  onRefresh: () => Promise<void>;
  onGenerate: () => Promise<void>;
  onImport: (privateKey: string) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const { t } = useI18n();
  const appDialog = useAppDialog();
  const { show: showTrustBluetoothSetupError } = useTrustBluetoothSetup();
  const theme = useTheme();
  const [action, setAction] = useState<"generate" | "import" | "reset">();
  const [privateKey, setPrivateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshingDevice, setRefreshingDevice] = useState(false);
  const privateKeyValid = /^[0-9a-fA-F]{64}$/.test(privateKey);

  const closeAction = () => {
    if (busy) return;
    void KeyboardController.dismiss({ animated: false });
    setAction(undefined);
    setPrivateKey("");
  };

  const runAction = async () => {
    const selectedAction = action;
    if (!selectedAction) return;
    const importedPrivateKey = privateKey;
    await KeyboardController.dismiss({ animated: false });
    setAction(undefined);
    setPrivateKey("");
    setBusy(true);
    try {
      if (selectedAction === "generate") await onGenerate();
      if (selectedAction === "import") await onImport(importedPrivateKey);
      if (selectedAction === "reset") await onReset();
    } catch (cause) {
      if (
        cause instanceof Error &&
        cause.message === "Cryptape Trust key operation was cancelled"
      ) return;
      if (!showTrustBluetoothSetupError(cause)) {
        appDialog.show(t("trustKeyOperationFailed"), errorMessage(cause, t));
      }
    } finally {
      setBusy(false);
    }
  };

  const actionTitle =
    action === "generate"
      ? t("generateTrustKey")
      : action === "import"
        ? t("importTrustKey")
        : t("resetTrustKey");
  const actionDescription =
    action === "generate"
      ? t("generateTrustKeyDescription")
      : action === "import"
        ? t("importTrustKeyDescription")
        : t("resetTrustKeyDescription");

  return (
    <>
      <ScrollView contentContainerStyle={[styles.page, styles.settingsPage]}>
        <Text variant="headlineMedium">{t("trustDevice")}</Text>
        <PaperCard mode="elevated">
          <PaperCard.Title
            title={device.name}
            leftStyle={styles.cardTitleLeft}
            left={({ size }) => (
              <CryptapeIcon color={theme.colors.onSurfaceVariant} size={size} />
            )}
          />
          <PaperCard.Content style={styles.cardContent}>
            <View style={styles.metadataBlock}>
              <Text variant="labelMedium">{t("deviceAddress")}</Text>
              <Text variant="bodyMedium" selectable style={styles.mono}>
                {device.id}
              </Text>
            </View>
            <Divider />
            <View style={styles.metadataBlock}>
              <Text variant="labelMedium">{t("publicKey")}</Text>
              {device.publicKey ? (
                <Text variant="bodySmall" selectable style={styles.mono}>
                  {device.publicKey}
                </Text>
              ) : (
                <Text variant="bodyMedium">{t("trustDeviceHasNoKey")}</Text>
              )}
            </View>
          </PaperCard.Content>
          <PaperCard.Actions style={styles.cardActions}>
            <PaperButton
              mode="contained-tonal"
              icon="refresh"
              loading={refreshingDevice}
              disabled={refreshingDevice}
              onPress={() => {
                setRefreshingDevice(true);
                void onRefresh()
                  .catch((cause: unknown) => {
                    if (!showTrustBluetoothSetupError(cause)) {
                      appDialog.show(
                        t("trustWalletConnectionFailed"),
                        errorMessage(cause, t),
                      );
                    }
                  })
                  .finally(() => setRefreshingDevice(false));
              }}
            >
              {t("refresh")}
            </PaperButton>
          </PaperCard.Actions>
        </PaperCard>

        <PaperCard mode="elevated">
          <PaperCard.Title
            title={t("trustKeyManagement")}
            leftStyle={styles.cardTitleLeft}
            left={(props) => <Icon {...props} source="key-chain-variant" />}
          />
          <PaperCard.Content style={styles.cardContent}>
            <Text variant="bodyMedium">
              {device.publicKey
                ? t("trustKeyPresentDescription")
                : t("trustKeyMissingDescription")}
            </Text>
          </PaperCard.Content>
          <PaperCard.Actions style={styles.cardActions}>
            {device.publicKey ? (
              <PaperButton
                mode="text"
                icon="key-remove"
                textColor={theme.colors.error}
                onPress={() => setAction("reset")}
              >
                {t("resetTrustKey")}
              </PaperButton>
            ) : null}
            {!device.publicKey ? (
              <PaperButton
                mode="text"
                icon="key-plus"
                onPress={() => setAction("import")}
              >
                {t("importTrustKey")}
              </PaperButton>
            ) : null}
            {!device.publicKey ? (
              <PaperButton
                mode="contained"
                icon="key-plus"
                onPress={() => setAction("generate")}
              >
                {t("generateTrustKey")}
              </PaperButton>
            ) : null}
          </PaperCard.Actions>
        </PaperCard>
      </ScrollView>

      <Portal>
        <KeyboardAvoidingView
          behavior="height"
          pointerEvents="box-none"
          style={styles.keyboardDialogLayer}
        >
          <Dialog
            visible={Boolean(action)}
            dismissable={!busy}
            onDismiss={closeAction}
            style={styles.keyboardDialog}
          >
            <Dialog.Title>{actionTitle}</Dialog.Title>
            <KeyboardDialogContent>
              <Text variant="bodyMedium">{actionDescription}</Text>
              {action === "import" ? (
                <WalletTextInput
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  label={t("trustPrivateKey")}
                  maxLength={64}
                  secureTextEntry
                  value={privateKey}
                  onChangeText={(value) =>
                    setPrivateKey(value.replace(/[^0-9a-f]/gi, ""))
                  }
                />
              ) : null}
            </KeyboardDialogContent>
            <Dialog.Actions style={styles.dialogActions}>
              <PaperButton
                contentStyle={styles.extraHorizontalButtonPadding}
                disabled={busy}
                onPress={closeAction}
              >
                {t("cancel")}
              </PaperButton>
              <PaperButton
                mode="contained"
                contentStyle={styles.extraHorizontalButtonPadding}
                buttonColor={action === "reset" ? theme.colors.error : undefined}
                loading={busy}
                disabled={busy || (action === "import" && !privateKeyValid)}
                onPress={() => void runAction()}
              >
                {action === "reset" ? t("resetTrustKey") : t("continue")}
              </PaperButton>
            </Dialog.Actions>
          </Dialog>
        </KeyboardAvoidingView>
      </Portal>
    </>
  );
}

function ApprovalPanel({
  item,
  network,
  signer,
  onRespond,
  onLayout,
}: {
  item?: ApprovalItem;
  network: Network;
  signer?: Signer;
  onRespond: (approved: boolean) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  if (!item) {
    return (
      <Text variant="bodySmall" style={styles.requestIdle}>
        {t("readyForRequests")}
      </Text>
    );
  }

  return (
    <View onLayout={onLayout} style={styles.approvalPanel}>
      <View style={styles.approvalHeading}>
        <Icon
          source={approvalIcon(item.request)}
          size={24}
          color={theme.colors.primary}
        />
        <Text variant="titleLarge" style={styles.flex}>
          {approvalTitle(item.request, t)}
        </Text>
      </View>
      <View style={styles.metadataBlock}>
        <Text variant="labelMedium">{t("network")}</Text>
        <Text variant="bodyLarge">
          {approvalNetwork(item.request, network, t)}
        </Text>
      </View>
      <ApprovalDetails request={item.request} signer={signer} />
      <View style={styles.approvalActions}>
        <PaperButton
          mode="outlined"
          contentStyle={styles.extraHorizontalButtonPadding}
          textColor={theme.colors.error}
          style={styles.flexAction}
          onPress={() => onRespond(false)}
        >
          {t("deny")}
        </PaperButton>
        <PaperButton
          mode="contained"
          contentStyle={styles.extraHorizontalButtonPadding}
          style={styles.flexAction}
          onPress={() => onRespond(true)}
        >
          {t("allow")}
        </PaperButton>
      </View>
    </View>
  );
}

function ApprovalDetails({
  request,
  signer,
}: {
  request: SignerJsonRpcConfirmation;
  signer?: Signer;
}) {
  const { t } = useI18n();
  if (request.method === "connect") {
    return <Text variant="bodyMedium">{t("connectApprovalDescription")}</Text>;
  }
  if (request.method === "sign_message") {
    return (
      <PaperCard mode="contained">
        <PaperCard.Title title={t("message")} />
        <PaperCard.Content>
          <Text variant="bodyMedium" selectable style={styles.mono}>{request.message.value}</Text>
        </PaperCard.Content>
      </PaperCard>
    );
  }
  return signer ? (
    <TransactionApprovalDetails
      client={signer.client}
      transaction={request.transaction}
    />
  ) : (
    <Text variant="bodyMedium">{t("unableToParse")}</Text>
  );
}

function approvalIcon(request: SignerJsonRpcConfirmation) {
  if (request.method === "connect") return "link-variant";
  if (request.method === "sign_message") return "message-text-lock";
  return "file-sign";
}

function approvalTitle(request: SignerJsonRpcConfirmation, t: Translate) {
  if (request.method === "connect") return t("webRequestsConnection");
  if (request.method === "sign_message") return t("confirmMessageSignature");
  return t("confirmTransactionSignature");
}

function approvalNetwork(request: SignerJsonRpcConfirmation, fallback: Network, t: Translate) {
  if (request.method === "connect") {
    if (request.networkId === "ckb-mainnet") return t("ckbMainnet");
    if (request.networkId === "ckb-testnet") return t("ckbTestnet");
    return request.networkId;
  }
  return fallback === "mainnet" ? t("ckbMainnet") : t("ckbTestnet");
}

function InactiveLastSeen({ timestamp }: { timestamp: number }) {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timeout = setTimeout(
      () => setNow(Date.now()),
      nextElapsedDurationBoundary(timestamp, now),
    );
    return () => clearTimeout(timeout);
  }, [now, timestamp]);

  return formatElapsedDuration(timestamp, now, t);
}

function formatElapsedDuration(timestamp: number, now: number, t: Translate) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) {
    if (seconds === 0) return t("justNow");
    return t(seconds === 1 ? "secondAgo" : "secondsAgo", { count: seconds });
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t(minutes === 1 ? "minuteAgo" : "minutesAgo", { count: minutes });
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t(hours === 1 ? "hourAgo" : "hoursAgo", { count: hours });
  }

  const days = Math.floor(hours / 24);
  return t(days === 1 ? "dayAgo" : "daysAgo", { count: days });
}

function nextElapsedDurationBoundary(timestamp: number, now: number) {
  const elapsed = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const unit =
    elapsed < minute
      ? 1_000
      : elapsed < hour
        ? minute
        : elapsed < day
          ? hour
          : day;
  const nextBoundary = timestamp + (Math.floor(elapsed / unit) + 1) * unit;
  return Math.max(1, nextBoundary - now);
}

function NetworkSwitch({ value, onChange }: { value: Network; onChange: (network: Network) => void }) {
  const { t } = useI18n();
  return (
    <SegmentedButtons
      density="small"
      value={value}
      onValueChange={(next) => onChange(next as Network)}
      buttons={[
        { value: "testnet", label: t("testnet"), showSelectedCheck: false },
        { value: "mainnet", label: t("mainnet"), showSelectedCheck: false },
      ]}
      style={styles.networkSwitch}
    />
  );
}

function WalletMenu({
  wallets,
  selected,
  onSelect,
}: {
  wallets: WalletProfile[];
  selected?: string;
  onSelect: (walletId: string) => void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <Menu
      visible={visible}
      onDismiss={() => setVisible(false)}
      anchor={
        <PaperButton
          mode="contained-tonal"
          icon="wallet"
          onPress={() => setVisible(true)}
          style={styles.walletMenu}
        >
          {walletLabel(wallets, selected ?? "", t)}
        </PaperButton>
      }
    >
      {wallets.map((wallet) => (
        <Menu.Item
          key={wallet.id}
          leadingIcon={wallet.id === selected ? "check" : "wallet-outline"}
          title={walletLabel(wallets, wallet.id, t)}
          onPress={() => {
            setVisible(false);
            if (wallet.id !== selected) {
              onSelect(wallet.id);
            }
          }}
        />
      ))}
    </Menu>
  );
}

function BottomBar({
  current,
  showTrust,
  onNavigate,
}: {
  current: Screen;
  showTrust: boolean;
  onNavigate: (screen: Screen) => void;
}) {
  const { t } = useI18n();
  const routes = [
    { key: "home", title: t("account"), focusedIcon: "wallet", unfocusedIcon: "wallet-outline" },
    {
      key: "khie",
      title: "Khie",
      focusedIcon: khieIconSource,
      unfocusedIcon: khieIconSource,
    },
    ...(showTrust
      ? [
          {
            key: "trust",
            title: "Cryptape Trust",
            focusedIcon: cryptapeIconSource,
            unfocusedIcon: cryptapeIconSource,
          },
        ]
      : []),
    { key: "settings", title: t("settings"), focusedIcon: "cog", unfocusedIcon: "cog-outline" },
  ];
  const selected = current === "receive" ? "home" : current;
  const index = Math.max(0, routes.findIndex(({ key }) => key === selected));
  return (
    <BottomNavigation.Bar
      compact
      shifting={false}
      navigationState={{ index, routes }}
      safeAreaInsets={{ bottom: 0 }}
      onTabPress={({ route }) => onNavigate(route.key as Screen)}
    />
  );
}

function LanguageMenu() {
  const { preference, setPreference, t } = useI18n();
  const [visible, setVisible] = useState(false);
  const choose = (next: Parameters<typeof setPreference>[0]) => {
    setVisible(false);
    setPreference(next);
  };

  return (
    <Menu
      visible={visible}
      onDismiss={() => setVisible(false)}
      anchor={
        <PaperButton mode="contained-tonal" icon="translate" onPress={() => setVisible(true)}>
          {languageLabel(preference, t)}
        </PaperButton>
      }
    >
      <Menu.Item
        leadingIcon={preference === "system" ? "check" : "cellphone-cog"}
        title={t("followSystem")}
        onPress={() => choose("system")}
      />
      <Divider />
      {languageOptions.map((option) => (
        <Menu.Item
          key={option.value}
          leadingIcon={preference === option.value ? "check" : undefined}
          title={option.label}
          onPress={() => choose(option.value)}
        />
      ))}
    </Menu>
  );
}

function walletLabel(wallets: WalletProfile[], walletId: string, t: Translate): string {
  const wallet = wallets.find((item) => item.id === walletId);
  if (wallet?.kind === "cryptape-trust") {
    return `Cryptape Trust · ${wallet.deviceId.slice(-5)}`;
  }
  const index = wallets.findIndex((wallet) => wallet.id === walletId);
  return t("walletNumber", { number: Math.max(0, index) + 1 });
}

function hasTrustPublicKeyChanged(cached?: string, connected?: string): boolean {
  if (!cached || !connected) return Boolean(cached) !== Boolean(connected);
  return normalizeTrustPublicKey(cached) !== normalizeTrustPublicKey(connected);
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <PaperButton mode="contained" disabled={disabled} onPress={onPress}>
      {label}
    </PaperButton>
  );
}

function SecondaryButton({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const theme = useTheme();
  return (
    <PaperButton
      mode="outlined"
      disabled={disabled}
      onPress={onPress}
      textColor={danger ? theme.colors.error : undefined}
    >
      {label}
    </PaperButton>
  );
}

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PaperButton
      compact
      mode="text"
      labelStyle={styles.linkButtonLabel}
      onPress={onPress}
    >
      {label}
    </PaperButton>
  );
}

function WalletTextInput(props: React.ComponentProps<typeof PaperTextInput>) {
  return <PaperTextInput mode="outlined" {...props} />;
}

function KeyboardDialogContent({ children }: { children: React.ReactNode }) {
  return (
    <Dialog.Content style={styles.keyboardDialogContent}>
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.cardContent}
        keyboardShouldPersistTaps="handled"
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </Dialog.Content>
  );
}

function FloatingLabelTextInput({
  label,
  accessibilityLabel,
  onBlur,
  onFocus,
  style,
  ...props
}: React.ComponentProps<typeof PaperTextInput> & { label: string }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.floatingInputContainer}>
      <WalletTextInput
        {...props}
        accessibilityLabel={accessibilityLabel ?? label}
        style={[styles.khieInput, style]}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
      />
      <View
        pointerEvents="none"
        style={[
          styles.floatingInputLabel,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <Text
          variant="bodySmall"
          style={{
            color: focused
              ? theme.colors.primary
              : theme.colors.onSurfaceVariant,
          }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

function QuietQrCode({ value, size }: { value: string; size: number }) {
  return (
    <View style={styles.qrFrame}>
      <QRCode
        value={value}
        size={size}
        color="black"
        backgroundColor="white"
        quietZone={12}
      />
    </View>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  const { t } = useI18n();
  return <PaperButton compact icon="arrow-left" onPress={onPress} style={styles.backButton}>{t("back")}</PaperButton>;
}

function Notice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <Portal>
      <Snackbar
        visible
        onDismiss={onDismiss}
        action={{ label: t("close"), onPress: onDismiss }}
        wrapperStyle={styles.snackbar}
      >
        {text}
      </Snackbar>
    </Portal>
  );
}

function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [dialog, setDialog] = useState<AppDialogState>();
  const show = useCallback((title: string, message: string) => {
    setDialog({ title, message });
  }, []);
  const confirm = useCallback((next: AppDialogState) => {
    setDialog(next);
  }, []);
  const value = useMemo(() => ({ show, confirm }), [confirm, show]);
  const dismiss = () => setDialog(undefined);
  const accept = () => {
    const onConfirm = dialog?.onConfirm;
    setDialog(undefined);
    onConfirm?.();
  };

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      <Portal>
        <Dialog visible={Boolean(dialog)} onDismiss={dismiss}>
          <Dialog.Title>{dialog?.title}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{dialog?.message}</Text>
          </Dialog.Content>
          <Dialog.Actions style={styles.dialogActions}>
            {dialog?.cancelLabel ? (
              <PaperButton
                contentStyle={styles.extraHorizontalButtonPadding}
                onPress={dismiss}
              >
                {dialog.cancelLabel}
              </PaperButton>
            ) : null}
            <PaperButton
              mode="contained"
              buttonColor={dialog?.destructive ? theme.colors.error : undefined}
              contentStyle={styles.extraHorizontalButtonPadding}
              onPress={accept}
            >
              {dialog?.confirmLabel ?? t("close")}
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </AppDialogContext.Provider>
  );
}

function useAppDialog(): AppDialogContextValue {
  const context = useContext(AppDialogContext);
  if (!context) throw new Error("AppDialogProvider is missing");
  return context;
}

function errorMessage(cause: unknown, t: Translate): string {
  if (!(cause instanceof Error)) return t("operationFailed");
  if (cause instanceof LocalizedError) {
    return t(cause.translationKey, cause.translationValues);
  }
  const exactErrors: Partial<Record<string, Parameters<Translate>[0]>> = {
    "Invalid password": "invalidWalletPassword",
    "Bluetooth permission is required to find Cryptape Trust devices": "trustBluetoothPermissionRequired",
    "Bluetooth is not available": "trustBluetoothUnavailable",
    "Bluetooth is not available on this device": "trustBluetoothUnavailable",
    "Turn on Bluetooth to find Cryptape Trust devices": "trustBluetoothDisabled",
    "Cryptape Trust signing was cancelled": "trustSigningCancelled",
    "Cryptape Trust PIN must contain 8 digits": "trustPinInvalid",
    "Cryptape Trust public key has changed": "trustPublicKeyChanged",
    "Trust hardware wallets are only available in an Android development build":
      "trustWalletAndroidBuildOnly",
  };
  const key = exactErrors[cause.message];
  if (key) return t(key);
  return cause.message;
}

function TrustBluetoothSetupProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [error, setError] = useState<TrustBluetoothSetupError>();
  const show = useCallback((cause: unknown) => {
    if (!(cause instanceof TrustBluetoothSetupError)) return false;
    setError(cause);
    return true;
  }, []);
  const value = useMemo(() => ({ show }), [show]);

  const details = error
    ? error.issue === "permissionDenied"
      ? {
          title: t("trustBluetoothPermissionTitle"),
          message: t("trustBluetoothPermissionRequired"),
        }
      : error.issue === "bluetoothDisabled"
        ? {
            title: t("trustBluetoothDisabledTitle"),
            message: t("trustBluetoothDisabled"),
          }
        : error.issue === "locationDisabled"
          ? {
              title: t("trustLocationDisabledTitle"),
              message: t("trustLocationDisabled"),
            }
          : {
              title: t("trustBluetoothUnavailableTitle"),
              message: t("trustBluetoothUnavailable"),
            }
    : undefined;

  const openSettings = () => {
    if (!error) return;
    const action =
      error.settings === "bluetooth"
        ? "android.settings.BLUETOOTH_SETTINGS"
        : error.settings === "location"
          ? "android.settings.LOCATION_SOURCE_SETTINGS"
          : undefined;
    setError(undefined);
    const open = action
      ? Linking.sendIntent(action).catch(() => Linking.openSettings())
      : Linking.openSettings();
    void open.catch(() => undefined);
  };

  return (
    <TrustBluetoothSetupContext.Provider value={value}>
      {children}
      <Portal>
        <Dialog visible={Boolean(error)} onDismiss={() => setError(undefined)}>
          <Dialog.Icon icon="bluetooth" />
          <Dialog.Title style={styles.centerText}>{details?.title}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{details?.message}</Text>
          </Dialog.Content>
          <Dialog.Actions style={styles.dialogActions}>
            <PaperButton
              mode={
                error?.issue === "bluetoothUnavailable"
                  ? "contained"
                  : "text"
              }
              contentStyle={styles.extraHorizontalButtonPadding}
              onPress={() => setError(undefined)}
            >
              {error?.issue === "bluetoothUnavailable"
                ? t("close")
                : t("cancel")}
            </PaperButton>
            {error?.issue !== "bluetoothUnavailable" ? (
              <PaperButton
                mode="contained"
                contentStyle={styles.extraHorizontalButtonPadding}
                onPress={openSettings}
              >
                {t("openSettings")}
              </PaperButton>
            ) : null}
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </TrustBluetoothSetupContext.Provider>
  );
}

function useTrustBluetoothSetup(): TrustBluetoothSetupContextValue {
  const context = useContext(TrustBluetoothSetupContext);
  if (!context) {
    throw new Error("TrustBluetoothSetupProvider is missing");
  }
  return context;
}

function walletAuthenticationPrompt(
  purpose: WalletAuthenticationPurpose,
  t: Translate,
): string {
  switch (purpose) {
    case "signMessage":
      return t("authenticationSignMessage");
    case "signTransaction":
      return t("authenticationSignTransaction");
    case "viewMnemonic":
      return t("authenticationViewMnemonic");
    case "viewPrivateKey":
      return t("authenticationViewPrivateKey");
    case "enableBiometrics":
      return t("authenticationEnableBiometrics");
    default:
      return t("authenticationUseWallet");
  }
}

function formatKhieError(error: KhieProviderSessionError, t: Translate): string {
  return error.kind === "incompatible-pairing-code"
    ? t("scanPairingCodeFromConnector")
    : error.message;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1 },
  page: { padding: 20, gap: 16 },
  onboardingStart: { flex: 1, alignItems: "center", padding: 20, paddingBottom: 12 },
  onboardingContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  settingsPage: { gap: 20 },
  center: { justifyContent: "center", alignItems: "center", gap: 16 },
  centerText: { textAlign: "center" },
  linkButtonLabel: { textDecorationLine: "underline" },
  trustBanner: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 24,
    overflow: "hidden",
  },
  trustBannerImage: { borderRadius: 24 },
  trustBannerTint: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  trustRiskNotice: { gap: 12, padding: 16, borderRadius: 12 },
  trustRiskNoticeHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  trustRiskLink: { alignSelf: "flex-start" },
  balanceBlock: { alignItems: "center", gap: 4, paddingVertical: 24 },
  balanceValue: { width: "100%", alignItems: "center" },
  balanceIntegerRow: { width: "100%", flexDirection: "row", alignItems: "center" },
  balanceActionSpacer: { width: 48 },
  balanceNumber: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "baseline",
  },
  balanceInteger: { textAlign: "center", fontVariant: ["tabular-nums"] },
  balanceRefresh: { width: 48, margin: 0 },
  balanceFraction: { textAlign: "center", fontVariant: ["tabular-nums"] },
  cardContent: { gap: 12 },
  recommendedSection: { gap: 8 },
  recommendedApps: { gap: 8 },
  keyboardDialogLayer: { flex: 1 },
  keyboardDialog: { marginVertical: 24, maxHeight: "90%" },
  keyboardDialogContent: { flexShrink: 1, minHeight: 0 },
  dialogActions: {
    flexWrap: "wrap",
    rowGap: 8,
    columnGap: 8,
    justifyContent: "flex-end",
    paddingHorizontal: 24,
  },
  trustPicker: { gap: 16 },
  trustPickerActions: { alignItems: "flex-end" },
  trustDeviceResult: { gap: 4 },
  trustDeviceConnectCompact: { marginHorizontal: 16 },
  inlineProgress: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardActions: {
    flexWrap: "wrap",
    rowGap: 8,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
  },
  walletListContent: { paddingHorizontal: 0 },
  walletListItem: { paddingRight: 16 },
  walletDeleteButton: { marginRight: 0, marginVertical: 0 },
  walletMenu: { alignSelf: "center" },
  extraHorizontalButtonPadding: { paddingHorizontal: 8 },
  metadataBlock: { gap: 4 },
  appInformationLink: { paddingHorizontal: 0 },
  appInformationSwitch: { paddingHorizontal: 0 },
  cardTitleLeft: {
    alignItems: "center",
    justifyContent: "center",
  },
  listItemCenteredAccessory: { alignSelf: "center", justifyContent: "center" },
  appInformationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
  },
  appInformationLabel: { width: 112 },
  appInformationValue: { flex: 1, minWidth: 0, textAlign: "right" },
  updateStatus: { flexDirection: "row", alignItems: "center", gap: 8 },
  updateStatusText: { flex: 1, minWidth: 0 },
  mono: { fontFamily: "monospace" },
  mnemonicInput: { minHeight: 144, textAlignVertical: "top" },
  words: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  backButton: { alignSelf: "flex-start", marginLeft: -12 },
  networkSwitch: { width: "100%" },
  pairingProgress: { minHeight: 320, alignItems: "center", justifyContent: "center", gap: 16 },
  khieContent: { gap: 16 },
  peerOverview: { flexDirection: "row", alignItems: "center", gap: 8 },
  peerMetadata: { gap: 12 },
  khieMethod: { gap: 12 },
  endpointCopyRow: {
    width: "100%",
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
  },
  endpointCopyRowPressed: { opacity: 0.6 },
  endpointCopyText: { flex: 1, minWidth: 0 },
  khieErrorNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  khieErrorCopy: { gap: 2 },
  khieInput: { height: 56 },
  floatingInputContainer: { position: "relative" },
  floatingInputLabel: {
    position: "absolute",
    top: -8,
    left: 12,
    zIndex: 1,
    paddingHorizontal: 4,
  },
  orDivider: { flexDirection: "row", alignItems: "center", gap: 12 },
  requestIdle: { paddingVertical: 12, textAlign: "center" },
  approvalPanel: { gap: 20, paddingBottom: 16 },
  approvalHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
  approvalActions: { flexDirection: "row", gap: 12 },
  flexAction: { flex: 1 },
  advancedSettingsToggle: { alignSelf: "flex-start", marginLeft: -12 },
  relaySettings: { gap: 12 },
  qrContent: { alignItems: "center", gap: 16, paddingBottom: 24 },
  qrFrame: { alignSelf: "center", padding: 12, borderRadius: 12, backgroundColor: "white" },
  qrPlaceholder: { alignItems: "center", justifyContent: "center", gap: 12 },
  snackbar: { marginBottom: 88 },
  scanner: { flex: 1, backgroundColor: "black" },
  scanFooter: { position: "absolute", left: 20, right: 20, bottom: 30, gap: 12 },
  scanText: { color: "white", textAlign: "center" },
  flex: { flex: 1 },
} as const);
