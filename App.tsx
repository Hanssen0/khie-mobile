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
  type WalletCredential,
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
import {
  AppDialogProvider,
  errorMessage,
  KeyboardDialogContent,
  LoadingScreen,
  Notice,
  TrustBluetoothSetupProvider,
  useAppDialog,
  useTrustBluetoothSetup,
  walletAuthenticationPrompt,
  WalletTextInput,
} from "./src/ui/components";
import { HomeScreen, ReceiveScreen } from "./src/ui/AccountScreens";
import { approvalNetwork, approvalTitle, KhieScreen, ScannerScreen } from "./src/ui/KhieScreen";
import { BottomBar, hasTrustPublicKeyChanged } from "./src/ui/navigation";
import { OnboardingScreen } from "./src/ui/OnboardingScreen";
import { SettingsScreen } from "./src/ui/SettingsScreen";
import { TrustDeviceScreen } from "./src/ui/TrustDeviceScreen";
import { styles } from "./src/ui/styles";

type Screen = "home" | "receive" | "khie" | "trust" | "settings" | "scanner";
type Onboarding = "start" | "create" | "confirm" | "password" | "restore" | "trust";
type WalletUnlockResult = {
  mnemonic?: string;
  credential: WalletCredential;
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
        let masterKey: string | null = null;
        let credentialRead = false;
        setBiometricUnlocking(true);
        try {
          masterKey = await vault.readBiometricMasterKey(purpose);
          credentialRead = true;
          if (masterKey) {
            const credential: WalletCredential = { kind: "masterKey", value: masterKey };
            return {
              mnemonic: await vault.readMnemonic(walletId, credential),
              credential,
            };
          }
        } catch {
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
      request.resolve({ mnemonic, credential });
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
    async (purpose) => {
      const disconnectedProfile =
        (purpose === "message" || purpose === "transaction") &&
        profile?.kind === "cryptape-trust" &&
        profile.publicKey &&
        trustDevice?.id.toLowerCase() !== profile.deviceId.toLowerCase()
          ? profile
          : undefined;
      if (disconnectedProfile) {
        await ensureTrustBluetoothReady("connect");
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

  const reportTrustSigningError = useCallback(
    (cause: unknown) => {
      if (
        cause instanceof Error &&
        cause.message === "Cryptape Trust signing was cancelled"
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
    <SafeAreaView
      edges={screen === "scanner" ? undefined : ["top", "right", "left"]}
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
    >
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
