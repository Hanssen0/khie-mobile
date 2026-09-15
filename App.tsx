import {
  buildSignerJsonRpcHandler,
  fixedPointToString,
  SignerCkbPublicKey,
  type Signer,
  type SignerJsonRpcConfirmation,
} from "@ckb-ccc/core";
import { CameraView, useCameraPermissions } from "expo-camera";
import { NavigationBar } from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  BackHandler,
  ImageBackground,
  Linking,
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
} from "react-native-keyboard-controller";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { RecommendedAppIcon } from "./src/components/RecommendedAppIcon";
import {
  I18nProvider,
  languageLabel,
  languageOptions,
  useI18n,
  type Translate,
} from "./src/i18n";
import { ApprovalQueue, type ApprovalItem } from "./src/khie/approvalQueue";
import { resumeKhieSessionWhenActive } from "./src/khie/appLifecycle";
import { TransactionApprovalDetails } from "./src/khie/TransactionApprovalDetails";
import {
  KhieProviderSession,
  type KhieProviderSessionState,
} from "./src/khie/KhieProviderSession";
import { DEFAULT_KHIE_RELAY_ADDRESS } from "./src/khie/protocol";
import {
  connectTrustWallet,
  disconnectTrustWallet,
  generateTrustWalletKey,
  importTrustWalletKey,
  isTrustSupported,
  resetTrustWalletKey,
  resetTrustWalletPin,
  scanForTrustDevices,
  type ConnectedTrustDevice,
  type TrustDevice,
} from "./src/trust/native";
import {
  SecureStoreNetworkSettings,
} from "./src/storage/networkSettings";
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
import type { Network, WalletProfile, WalletState } from "./src/wallet/types";
import { generateMnemonic, persistWallet, recoverWallet } from "./src/wallet/walletService";
import { walletDarkTheme, walletLightTheme } from "./src/theme";

type Screen = "home" | "receive" | "khie" | "trust" | "settings" | "scanner";
type Onboarding = "start" | "create" | "confirm" | "restore" | "trust";
type TrustPinRequest = {
  purpose: "connect" | "message" | "transaction" | "keyManagement";
  deviceId?: string;
  reject: (cause: Error) => void;
  resolve: (pin: string) => void;
};

const endpointUrl = "https://app.ckbccc.com/khie";

export default function App() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === "dark" ? walletDarkTheme : walletLightTheme;

  return (
    <SafeAreaProvider>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <NavigationBar style="auto" />
        <I18nProvider>
          <PaperProvider theme={theme}>
            <WalletApp />
          </PaperProvider>
        </I18nProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function WalletApp() {
  const { t } = useI18n();
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
  const approvalQueue = useMemo(() => new ApprovalQueue(), []);
  const clients = useRef({
    mainnet: clientForNetwork("mainnet"),
    testnet: clientForNetwork("testnet"),
  });
  const signerRef = useRef<Signer | undefined>(undefined);
  const sessionRef = useRef<KhieProviderSession | undefined>(undefined);
  const networkRef = useRef<Network>("testnet");
  const previousPaired = useRef(false);

  const [loading, setLoading] = useState(true);
  const [walletState, setWalletState] = useState<WalletState>({ version: 3, wallets: [] });
  const [network, setNetwork] = useState<Network>("testnet");
  const [rpcUrls, setRpcUrls] = useState<NetworkRpcUrls>(DEFAULT_NETWORK_RPC_URLS);
  const [screen, setScreen] = useState<Screen>("home");
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
  const [trustPinResetOpen, setTrustPinResetOpen] = useState(false);
  const [trustPuk, setTrustPuk] = useState("");
  const [trustNewPin, setTrustNewPin] = useState("");
  const [trustConfirmPin, setTrustConfirmPin] = useState("");
  const [resettingTrustPin, setResettingTrustPin] = useState(false);

  const requestTrustPin = useCallback<RequestTrustPin>(
    (purpose) =>
      new Promise((resolve, reject) => {
        setTrustPin("");
        setTrustPinRequest({ purpose, reject, resolve });
      }),
    [],
  );

  useEffect(
    () =>
      approvalQueue.subscribe((item) => {
        setApproval(item);
        if (item) {
          setScreen("khie");
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

  const profile =
    walletState.wallets.find((wallet) => wallet.id === walletState.selectedWalletId) ??
    walletState.wallets[0];

  const releaseTrustConnection = useCallback(async () => {
    try {
      await disconnectTrustWallet();
    } finally {
      setTrustDevice(undefined);
    }
  }, []);

  const requestTrustSigningPin = useCallback<RequestTrustPin>(
    async (purpose) => {
      const pin = await requestTrustPin(purpose);
      if (
        (purpose !== "message" && purpose !== "transaction") ||
        profile?.kind !== "cryptape-trust" ||
        !profile.publicKey ||
        trustDevice?.id.toLowerCase() === profile.deviceId.toLowerCase()
      ) {
        return pin;
      }

      const device = await connectTrustWallet(profile.deviceId, pin);
      if (
        !device.publicKey ||
        normalizeTrustPublicKey(device.publicKey) !==
          normalizeTrustPublicKey(profile.publicKey)
      ) {
        await releaseTrustConnection().catch(() => undefined);
        throw new Error("Cryptape Trust public key has changed");
      }
      setTrustDevice(device);
      return pin;
    },
    [profile, releaseTrustConnection, requestTrustPin, trustDevice],
  );

  const localBackend = useMemo(
    () =>
      profile?.kind === "mnemonic"
        ? new LocalMnemonicSigningBackend(profile, vault, profile.id)
        : undefined,
    [profile, vault],
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
          throw new Error("Wallet is unavailable");
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
      void session.close();
    };
  }, [approvalQueue, backend?.account.publicKey, profile?.kind]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
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
    async (deviceId: string) => {
      const pin = await new Promise<string>((resolve, reject) => {
        setTrustPin("");
        setTrustPinRequest({ purpose: "connect", deviceId, reject, resolve });
      });
      const device = await connectTrustWallet(deviceId, pin);
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
    async (deviceId: string) => {
      try {
        const device = await connectTrust(deviceId);
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
      throw new Error("Cryptape Trust wallet is unavailable");
    }
    const pin = await requestTrustPin("keyManagement");
    if (trustDevice?.id.toLowerCase() === profile.deviceId.toLowerCase()) {
      return { device: trustDevice, pin };
    }

    const device = await connectTrustWallet(profile.deviceId, pin);
    setTrustDevice(device);
    setWalletState(await vault.saveCryptapeTrust(device));
    if (hasTrustPublicKeyChanged(profile.publicKey, device.publicKey)) {
      approvalQueue.cancelAll("Wallet changed");
      if (sessionState.paired) {
        void sessionRef.current?.unpair().catch(() => undefined);
      }
      throw new Error("Cryptape Trust public key has changed");
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
          throw new Error("Cryptape Trust returned a different public key after import");
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
      throw new Error("Cryptape Trust wallet is unavailable");
    }
    try {
      const device = await connectTrust(profile.deviceId);
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
      if (!target) throw new Error("Unknown wallet");
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
    [activateWalletState, clearTrustConnection, trustDevice, vault, walletState.wallets],
  );

  const trustDialogs = (
    <Portal>
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
              }}
            >
              {t("cancel")}
            </PaperButton>
            <PaperButton
              mode="contained"
              contentStyle={styles.extraHorizontalButtonPadding}
              disabled={trustPin.length !== 8}
              onPress={() => {
                trustPinRequest?.resolve(trustPin);
                setTrustPinRequest(undefined);
                setTrustPin("");
              }}
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
              onPress={() => setTrustPinResetOpen(false)}
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
                  .catch((cause: unknown) =>
                    Alert.alert(t("trustPinResetFailed"), errorMessage(cause, t)),
                  )
                  .finally(() => setResettingTrustPin(false));
              }}
            >
              {t("resetTrustPin")}
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
      </KeyboardAvoidingView>
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
            vault={vault}
            onChangeNetwork={changeNetwork}
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
            onRecovered={(next) => {
              setWalletState(next);
              setNotice(t("walletKeyRecovered"));
            }}
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
  onMode,
  onComplete,
  onConnectTrust,
  onCancel,
  onError,
}: {
  mode: Onboarding;
  vault: SecureStoreWalletVault;
  onMode: (mode: Onboarding) => void;
  onComplete: (state: WalletState) => Promise<void> | void;
  onConnectTrust: (deviceId: string) => Promise<void>;
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === "start" && !onCancel) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (mode === "confirm") {
        onMode("create");
      } else if (mode !== "start") {
        onMode("start");
      } else {
        onCancel?.();
      }
      return true;
    });
    return () => subscription.remove();
  }, [mode, onCancel, onMode]);

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

  const save = async (value: string) => {
    setBusy(true);
    try {
      await onComplete(await persistWallet(vault, value));
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
        void save(generatedMnemonic);
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
          onPress={() => void save(restoreMnemonic)}
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
            left={(props) => <Icon {...props} source="bluetooth" />}
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
        <PaperCard.Title title={t("walletAddress")} left={(props) => <Icon {...props} source="identifier" />} />
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
            <PaperCard
              key={app.url}
              mode="elevated"
              onPress={() => void Linking.openURL(app.url).catch(() => undefined)}
            >
              <PaperCard.Content style={styles.recommendedAppContent}>
                <View style={styles.recommendedAppLogo}>
                  <RecommendedAppIcon
                    name={app.icon}
                    size={32}
                    color={theme.colors.primary}
                  />
                </View>
                <View style={styles.recommendedAppCopy}>
                  <Text variant="titleMedium" numberOfLines={1}>{app.name}</Text>
                  <Text
                    variant="bodyMedium"
                    numberOfLines={2}
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    {app.description}
                  </Text>
                </View>
                <Icon
                  source="open-in-new"
                  size={20}
                  color={theme.colors.onSurfaceVariant}
                />
              </PaperCard.Content>
            </PaperCard>
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
  const [endpoint, setEndpoint] = useState("");
  const [relayAddress, setRelayAddress] = useState(state.relayAddress);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const qrSize = Math.max(180, Math.min(420, width - 64));

  useEffect(() => setRelayAddress(state.relayAddress), [state.relayAddress]);

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
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text variant="headlineMedium">Khie</Text>
      <PaperCard mode="contained">
        <PaperCard.Title
          title={t("khieIntroductionTitle")}
          left={(props) => <Icon {...props} source="connection" />}
        />
        <PaperCard.Content style={styles.khieIntroductionContent}>
          <Text variant="bodyMedium">{t("khieIntroduction")}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {t("khieNameMeaning")}
          </Text>
        </PaperCard.Content>
      </PaperCard>

      {pairing ? (
        <View style={styles.pairingProgress}>
          <ActivityIndicator size="large" />
          <Text variant="titleLarge">{t("pairingWithKhie")}</Text>
          <PaperButton mode="text" onPress={onCancelPairing}>{t("cancel")}</PaperButton>
        </View>
      ) : state.paired ? (
        <View style={styles.khieContent}>
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
          />
        </View>
      ) : (
        <View style={styles.khieContent}>
          <View style={styles.khieMethod}>
            <Text variant="titleSmall">{t("letConnectorScanThis")}</Text>
            {state.endpoint ? (
              <>
                <QuietQrCode value={state.endpoint} size={qrSize} />
                <Text variant="labelSmall" selectable numberOfLines={2} style={[styles.mono, styles.centerText]}>
                  {state.endpoint}
                </Text>
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
          <View style={styles.orDivider}>
            <Divider style={styles.flex} />
            <Text variant="labelMedium">{t("or")}</Text>
            <Divider style={styles.flex} />
          </View>
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

      {state.error && !pairing ? (
        <HelperText type="error" visible>
          {formatKhieError(state.error, t)}
        </HelperText>
      ) : null}
    </ScrollView>
  );
}

function ScannerScreen({ onCancel, onScanned }: { onCancel: () => void; onScanned: (value: string) => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  if (!permission) {
    return <View style={[styles.page, styles.center]}><ActivityIndicator /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={[styles.page, styles.center]}>
        <Icon source="camera" size={48} color={theme.colors.primary} />
        <Text variant="titleLarge" style={styles.centerText}>{t("cameraPermissionRequired")}</Text>
        <Text variant="bodyMedium" style={styles.centerText}>{t("cameraPermissionReason")}</Text>
        <PrimaryButton label={t("allowCamera")} onPress={() => void requestPermission()} />
        <SecondaryButton label={t("back")} onPress={onCancel} />
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
      <View style={styles.scanGuide} />
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
  vault,
  onChangeNetwork,
  onSelectWallet,
  onAddWallet,
  onRemoveWallet,
  onSaveRpcUrls,
  onRecovered,
}: {
  backend?: LocalMnemonicSigningBackend;
  network: Network;
  profile: WalletProfile;
  wallets: WalletProfile[];
  rpcUrls: NetworkRpcUrls;
  vault: SecureStoreWalletVault;
  onChangeNetwork: (network: Network) => void;
  onSelectWallet: (walletId: string) => Promise<void>;
  onAddWallet: () => void;
  onRemoveWallet: (walletId: string) => Promise<void>;
  onSaveRpcUrls: (urls: NetworkRpcUrls) => Promise<void>;
  onRecovered: (state: WalletState) => void;
}) {
  const { t } = useI18n();
  const [secret, setSecret] = useState<{ label: string; value: string }>();
  const [rpcDraft, setRpcDraft] = useState<NetworkRpcUrls>(rpcUrls);
  const [savingRpcUrls, setSavingRpcUrls] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryMnemonic, setRecoveryMnemonic] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [walletAddresses, setWalletAddresses] = useState<Record<string, string>>({});
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
      Alert.alert(t("unableToSave"), errorMessage(cause, t));
    } finally {
      setSavingRpcUrls(false);
    }
  };
  const reveal = async (kind: "mnemonic" | "privateKey") => {
    if (!backend) return;
    try {
      setSecret({
        label: kind === "mnemonic" ? t("mnemonic") : t("privateKey"),
        value: kind === "mnemonic" ? await backend.exportMnemonic() : await backend.exportPrivateKey(),
      });
    } catch (cause) {
      Alert.alert(t("unableToDisplay"), errorMessage(cause, t));
    }
  };
  const confirmRemove = (wallet: WalletProfile) => {
    Alert.alert(
      t("deleteWalletTitle", { wallet: walletLabel(wallets, wallet.id, t) }),
      t(wallet.kind === "cryptape-trust" ? "removeTrustWalletDescription" : "deleteWalletDescription"),
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("delete"),
          style: "destructive",
          onPress: () => {
            void onRemoveWallet(wallet.id).catch((cause: unknown) =>
              Alert.alert(t("unableToDeleteWallet"), errorMessage(cause, t)),
            );
          },
        },
      ],
    );
  };
  return (
    <KeyboardAwareScrollView
      bottomOffset={16}
      contentContainerStyle={[styles.page, styles.settingsPage]}
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="headlineMedium">{t("settingsAndExport")}</Text>
      <PaperCard mode="elevated">
        <PaperCard.Title title={t("wallets")} left={(props) => <Icon {...props} source="wallet" />} />
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
                      Alert.alert(t("unableToSwitchWallet"), errorMessage(cause, t)),
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
        <PaperCard.Title title={t("language")} left={(props) => <Icon {...props} source="translate" />} />
        <PaperCard.Content>
          <LanguageMenu />
        </PaperCard.Content>
      </PaperCard>
      <PaperCard mode="elevated">
        <PaperCard.Title title={t("network")} left={(props) => <Icon {...props} source="web" />} />
        <PaperCard.Content>
          <NetworkSwitch value={network} onChange={onChangeNetwork} />
        </PaperCard.Content>
      </PaperCard>
      <PaperCard mode="elevated">
        <PaperCard.Title
          title={t("networkRpc")}
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
          <PaperCard.Title title={t("accountInformation")} left={(props) => <Icon {...props} source="account-key" />} />
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
          <PaperCard.Title title={secret.label} left={(props) => <Icon {...props} source="shield-key" />} />
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
      {profile.kind === "mnemonic" ? <PaperCard mode="elevated">
        <PaperCard.Title
          title={t("keyRecovery")}
          left={(props) => <Icon {...props} source="backup-restore" />}
        />
        <PaperCard.Content style={styles.cardContent}>
          <Text variant="bodyMedium">
            {t("keyRecoveryDescription")}
          </Text>
          {showRecovery ? (
            <WalletTextInput
              style={styles.mnemonicInput}
              multiline
              label={t("mnemonic")}
              autoCapitalize="none"
              autoCorrect={false}
              value={recoveryMnemonic}
              onChangeText={setRecoveryMnemonic}
            />
          ) : null}
        </PaperCard.Content>
        <PaperCard.Actions style={styles.cardActions}>
          <PaperButton
            mode="text"
            icon={showRecovery ? "close" : "key-variant"}
            onPress={() => {
              setShowRecovery((value) => !value);
              setRecoveryMnemonic("");
            }}
          >
            {showRecovery ? t("cancel") : t("recoverWithMnemonic")}
          </PaperButton>
          {showRecovery ? (
            <PaperButton
              mode="contained"
              icon="restore"
              loading={recovering}
              disabled={recovering || !recoveryMnemonic.trim()}
              onPress={() => {
                setRecovering(true);
                void recoverWallet(vault, profile, recoveryMnemonic)
                  .then((next) => {
                    setSecret(undefined);
                    setRecoveryMnemonic("");
                    setShowRecovery(false);
                    onRecovered(next);
                  })
                  .catch((cause: unknown) => Alert.alert(t("recoveryFailed"), errorMessage(cause, t)))
                  .finally(() => setRecovering(false));
              }}
            >
              {t("verifyAndRecover")}
            </PaperButton>
          ) : null}
        </PaperCard.Actions>
      </PaperCard> : null}
    </KeyboardAwareScrollView>
  );
}

function TrustWalletPicker({
  onConnect,
}: {
  onConnect: (deviceId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [devices, setDevices] = useState<TrustDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string>();
  const supported = isTrustSupported();

  const scan = async () => {
    setScanning(true);
    setDevices([]);
    try {
      setDevices(await scanForTrustDevices());
    } catch (cause) {
      Alert.alert(t("trustWalletConnectionFailed"), errorMessage(cause, t));
    } finally {
      setScanning(false);
    }
  };

  const connect = async (device: TrustDevice) => {
    setConnectingId(device.id);
    try {
      await onConnect(device.id);
      setDevices([]);
    } catch (cause) {
      Alert.alert(t("trustWalletConnectionFailed"), errorMessage(cause, t));
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
        <List.Item
          key={device.id}
          title={device.name}
          description={device.id}
          left={(props) => <List.Icon {...props} icon="memory" />}
          right={() => (
            <PaperButton
              mode="text"
              compact
              loading={connectingId === device.id}
              disabled={Boolean(connectingId)}
              labelStyle={styles.linkButtonLabel}
              onPress={() => void connect(device)}
            >
              {t("connect")}
            </PaperButton>
          )}
        />
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
      Alert.alert(t("trustKeyOperationFailed"), errorMessage(cause, t));
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
            left={(props) => <Icon {...props} source="bluetooth" />}
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
                  .catch((cause: unknown) =>
                    Alert.alert(t("trustWalletConnectionFailed"), errorMessage(cause, t)),
                  )
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
}: {
  item?: ApprovalItem;
  network: Network;
  signer?: Signer;
  onRespond: (approved: boolean) => void;
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
    <View style={styles.approvalPanel}>
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
    { key: "khie", title: "Khie", focusedIcon: "connection", unfocusedIcon: "connection" },
    ...(showTrust
      ? [
          {
            key: "trust",
            title: "Cryptape Trust",
            focusedIcon: "usb-flash-drive",
            unfocusedIcon: "usb-flash-drive-outline",
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

function errorMessage(cause: unknown, t: Translate): string {
  if (!(cause instanceof Error)) return t("operationFailed");
  const exactErrors: Partial<Record<string, Parameters<Translate>[0]>> = {
    "请输入有效的 12 或 24 词英文 BIP-39 助记词": "invalidMnemonic",
    "新钱包需要 128 位安全随机熵": "invalidEntropy",
    "无法从助记词派生 CKB 账户": "derivationFailed",
    "助记词与当前账户不匹配": "mnemonicMismatch",
    "请先在 Android 系统中启用生物识别认证": "biometricRequired",
    "Invalid profile": "invalidProfile",
    "Bluetooth permission is required to find Cryptape Trust devices": "trustBluetoothPermissionRequired",
    "Bluetooth is not available": "trustBluetoothUnavailable",
    "Bluetooth is not available on this device": "trustBluetoothUnavailable",
    "Turn on Bluetooth to find Cryptape Trust devices": "trustBluetoothDisabled",
    "Cryptape Trust signing was cancelled": "trustSigningCancelled",
    "Cryptape Trust PIN must contain 8 digits": "trustPinInvalid",
    "Cryptape Trust public key has changed": "trustPublicKeyChanged",
  };
  const key = exactErrors[cause.message];
  if (key) return t(key);
  const unsupported = cause.message.match(/^不支持的网络：(.+)$/);
  if (unsupported) return t("unsupportedNetwork", { network: unsupported[1] ?? "" });
  return cause.message;
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
    default:
      return t("authenticationUseWallet");
  }
}

function formatKhieError(message: string, t: Translate): string {
  if (message.startsWith("Expected a connector pairing endpoint")) {
    return t("wrongPairingRole");
  }
  if (message === "Pairing endpoint is not a valid URL") {
    return t("invalidPairingUrl");
  }
  if (message === "Pairing endpoint is incomplete") {
    return t("incompletePairingUrl");
  }
  if (message === "Pairing endpoint contains invalid compressed addresses") {
    return t("damagedPairingUrl");
  }
  return message;
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
  recommendedAppContent: {
    height: 104,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
  },
  recommendedAppLogo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  recommendedAppCopy: { flex: 1, gap: 2 },
  keyboardDialogLayer: { flex: 1 },
  keyboardDialog: { marginVertical: 24, maxHeight: "90%" },
  keyboardDialogContent: { flexShrink: 1, minHeight: 0 },
  dialogActions: {
    flexWrap: "wrap",
    rowGap: 8,
    paddingHorizontal: 24,
  },
  trustPicker: { gap: 16 },
  trustPickerActions: { alignItems: "flex-end" },
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
  mono: { fontFamily: "monospace" },
  mnemonicInput: { minHeight: 144, textAlignVertical: "top" },
  words: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  backButton: { alignSelf: "flex-start", marginLeft: -12 },
  networkSwitch: { width: "100%" },
  pairingProgress: { minHeight: 320, alignItems: "center", justifyContent: "center", gap: 16 },
  khieContent: { gap: 16 },
  khieIntroductionContent: { gap: 8 },
  peerOverview: { flexDirection: "row", alignItems: "center", gap: 8 },
  peerMetadata: { gap: 12 },
  khieMethod: { gap: 12 },
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
  scanGuide: { position: "absolute", width: 250, height: 250, borderWidth: 3, borderColor: "white", borderRadius: 30, alignSelf: "center", top: "25%" },
  scanFooter: { position: "absolute", left: 20, right: 20, bottom: 30, gap: 12 },
  scanText: { color: "white", textAlign: "center" },
  flex: { flex: 1 },
} as const);
