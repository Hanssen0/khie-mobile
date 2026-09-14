import {
  buildSignerJsonRpcHandler,
  fixedPointToString,
  type Signer,
  type SignerJsonRpcConfirmation,
} from "@ckb-ccc/core";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  Appbar,
  BottomNavigation,
  Button as PaperButton,
  Card as PaperCard,
  Chip,
  HelperText,
  PaperProvider,
  Portal,
  SegmentedButtons,
  Snackbar,
  Surface,
  Text,
  TextInput as PaperTextInput,
  useTheme,
} from "react-native-paper";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { ApprovalQueue, type ApprovalItem } from "./src/khie/approvalQueue";
import {
  KhieProviderSession,
  type KhieProviderSessionState,
} from "./src/khie/KhieProviderSession";
import { SecureStoreWalletVault } from "./src/storage/walletVault";
import { LocalMnemonicSigningBackend } from "./src/wallet/localMnemonicBackend";
import { KhieSignerAdapter } from "./src/wallet/khieSignerAdapter";
import { clientForNetwork, networkFromId } from "./src/wallet/network";
import type { Network, WalletProfile } from "./src/wallet/types";
import { generateMnemonic, persistWallet } from "./src/wallet/walletService";
import { walletSemanticColors, walletTheme } from "./src/theme";

type Screen = "home" | "receive" | "khie" | "settings" | "scanner";
type Onboarding = "start" | "create" | "restore";

const endpointUrl = "https://app.ckbccc.com/khie";

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={walletTheme}>
        <WalletApp />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

function WalletApp() {
  const vault = useMemo(() => new SecureStoreWalletVault(), []);
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
  const [profile, setProfile] = useState<WalletProfile>();
  const [network, setNetwork] = useState<Network>("testnet");
  const [screen, setScreen] = useState<Screen>("home");
  const [onboarding, setOnboarding] = useState<Onboarding>("start");
  const [approval, setApproval] = useState<ApprovalItem>();
  const [pairing, setPairing] = useState(false);
  const [sessionState, setSessionState] = useState<KhieProviderSessionState>({
    endpoint: "",
    paired: false,
    ready: false,
    relayConnected: false,
  });
  const [notice, setNotice] = useState<string>();

  useEffect(() => approvalQueue.subscribe(setApproval), [approvalQueue]);

  useEffect(() => {
    void vault
      .loadProfile()
      .then(setProfile)
      .catch((cause: unknown) => setNotice(errorMessage(cause)))
      .finally(() => setLoading(false));
  }, [vault]);

  const backend = useMemo(
    () => profile && new LocalMnemonicSigningBackend(profile, vault),
    [profile, vault],
  );

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
    if (!backend) {
      return;
    }
    const handler = buildSignerJsonRpcHandler({
      getSigner: () => signerRef.current,
      getSignerMetadata: () => ({ name: "Khie Wallet" }),
      confirmRequest: (request) => approvalQueue.enqueue(request),
      connect: async (networkId) => {
        const next = networkFromId(networkId);
        networkRef.current = next;
        const signer = new KhieSignerAdapter(clients.current[next], backend);
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
    void session.start().catch((cause: unknown) => setNotice(errorMessage(cause)));
    return () => {
      approvalQueue.cancelAll("Khie session closed");
      sessionRef.current = undefined;
      void session.close();
    };
  }, [approvalQueue, backend]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void sessionRef.current?.resume();
      } else {
        approvalQueue.cancelAll("App entered background");
      }
    });
    return () => subscription.remove();
  }, [approvalQueue]);

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

  if (loading) {
    return <LoadingScreen />;
  }

  const finishOnboarding = (next: WalletProfile) => {
    setProfile(next);
    setOnboarding("start");
    setScreen("home");
  };

  if (!profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="auto" />
        {notice ? <Notice text={notice} onDismiss={() => setNotice(undefined)} /> : null}
        <OnboardingScreen
          mode={onboarding}
          vault={vault}
          onMode={setOnboarding}
          onComplete={finishOnboarding}
          onError={(cause) => setNotice(errorMessage(cause))}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="auto" />
      {notice ? <Notice text={notice} onDismiss={() => setNotice(undefined)} /> : null}
      <Appbar.Header statusBarHeight={0} style={styles.appHeader}>
        <Appbar.Content title="Khie Wallet" titleStyle={styles.appTitle} />
        <NetworkSwitch value={network} onChange={changeNetwork} />
      </Appbar.Header>
      <View style={styles.body}>
        {screen === "home" ? (
          <HomeScreen signer={signerRef.current} network={network} onNavigate={setScreen} />
        ) : null}
        {screen === "receive" ? (
          <ReceiveScreen signer={signerRef.current} onBack={() => setScreen("home")} />
        ) : null}
        {screen === "khie" ? (
          <KhieScreen
            state={sessionState}
            pairing={pairing}
            onScan={() => setScreen("scanner")}
            onPair={pairKhieEndpoint}
            onCancelPairing={cancelKhiePairing}
            onRetryRelay={() => sessionRef.current?.connectRelay() ?? Promise.resolve(false)}
            onUnpair={() => sessionRef.current?.unpair() ?? Promise.resolve()}
          />
        ) : null}
        {screen === "settings" ? (
          <SettingsScreen
            backend={backend!}
            profile={profile}
            vault={vault}
            onRecovered={(next) => {
              setProfile(next);
              setNotice("钱包密钥已恢复");
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
      {screen !== "scanner" ? <BottomBar current={screen} onNavigate={setScreen} /> : null}
      <ApprovalModal
        item={approval}
        network={network}
        signer={signerRef.current}
        onRespond={(approved) => approval && approvalQueue.respond(approval.id, approved)}
      />
    </SafeAreaView>
  );
}

function LoadingScreen() {
  return (
    <SafeAreaView style={[styles.safe, styles.center]}>
      <ActivityIndicator size="large" />
      <Text style={styles.muted}>正在读取钱包资料…</Text>
    </SafeAreaView>
  );
}

function OnboardingScreen({
  mode,
  vault,
  onMode,
  onComplete,
  onError,
}: {
  mode: Onboarding;
  vault: SecureStoreWalletVault;
  onMode: (mode: Onboarding) => void;
  onComplete: (profile: WalletProfile) => void;
  onError: (cause: unknown) => void;
}) {
  const [mnemonic, setMnemonic] = useState("");
  const [word3, setWord3] = useState("");
  const [word9, setWord9] = useState("");
  const [busy, setBusy] = useState(false);

  const beginCreate = async () => {
    setBusy(true);
    try {
      setMnemonic(await generateMnemonic());
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
      onComplete(await persistWallet(vault, value));
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  };

  if (mode === "start") {
    return (
      <View style={[styles.page, styles.center]}>
        <Text style={styles.hero}>Khie Wallet</Text>
        <Text style={styles.subtitle}>一个简单的 CKB 钱包与 Khie Provider</Text>
        <PrimaryButton label="创建新钱包" onPress={() => void beginCreate()} disabled={busy} />
        <SecondaryButton label="恢复钱包" onPress={() => onMode("restore")} />
        <Text style={styles.warning}>开发版本，未经安全审计。主网使用风险由使用者承担。</Text>
      </View>
    );
  }

  if (mode === "restore") {
    return (
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <BackButton onPress={() => onMode("start")} />
        <Text style={styles.heading}>恢复钱包</Text>
        <Text style={styles.muted}>输入 12 或 24 词英文 BIP-39 助记词。</Text>
        <WalletTextInput
          style={[styles.input, styles.mnemonicInput]}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="word1 word2 …"
          value={mnemonic}
          onChangeText={setMnemonic}
        />
        <PrimaryButton label={busy ? "正在保存…" : "恢复"} onPress={() => void save(mnemonic)} disabled={busy} />
      </ScrollView>
    );
  }

  const words = mnemonic.split(" ");
  const confirmed = word3.trim().toLowerCase() === words[2] && word9.trim().toLowerCase() === words[8];
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <BackButton onPress={() => onMode("start")} />
      <Text style={styles.heading}>备份助记词</Text>
      <Text style={styles.warning}>按顺序抄写。任何人拿到这些词都可以控制钱包。</Text>
      <View style={styles.words}>
        {words.map((word, index) => (
          <View key={`${word}-${index}`} style={styles.word}>
            <Text style={styles.wordIndex}>{index + 1}</Text>
            <Text>{word}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.label}>输入第 3 个词</Text>
      <WalletTextInput style={styles.input} autoCapitalize="none" value={word3} onChangeText={setWord3} />
      <Text style={styles.label}>输入第 9 个词</Text>
      <WalletTextInput style={styles.input} autoCapitalize="none" value={word9} onChangeText={setWord9} />
      <PrimaryButton label={busy ? "正在保存…" : "确认并创建"} onPress={() => void save(mnemonic)} disabled={!confirmed || busy} />
    </ScrollView>
  );
}

function HomeScreen({
  signer,
  network,
  onNavigate,
}: {
  signer?: Signer;
  network: Network;
  onNavigate: (screen: Screen) => void;
}) {
  const [address, setAddress] = useState("正在生成地址…");
  const [balance, setBalance] = useState("—");
  const [refreshing, setRefreshing] = useState(false);

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
        setAddress("地址读取失败");
      }
      setBalance("读取失败");
    } finally {
      setRefreshing(false);
    }
  }, [signer]);

  useEffect(() => void refresh(), [refresh, network]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.networkLabel}>{network === "testnet" ? "CKB 测试网" : "CKB 主网"}</Text>
      <Text style={styles.balance}>{balance}</Text>
      <Text style={styles.unit}>CKB</Text>
      <Card>
        <Text style={styles.label}>地址</Text>
        <Text selectable style={styles.mono}>{address}</Text>
      </Card>
      <PrimaryButton label="收款" onPress={() => onNavigate("receive")} />
      <SecondaryButton label={refreshing ? "刷新中…" : "刷新余额"} onPress={() => void refresh()} disabled={refreshing} />
    </ScrollView>
  );
}

function ReceiveScreen({ signer, onBack }: { signer?: Signer; onBack: () => void }) {
  const [address, setAddress] = useState("");
  useEffect(() => {
    void signer?.getRecommendedAddress().then(setAddress);
  }, [signer]);
  return (
    <ScrollView contentContainerStyle={[styles.page, styles.center]}>
      <BackButton onPress={onBack} />
      <Text style={styles.heading}>收款</Text>
      {address ? <QRCode value={address} size={230} /> : <ActivityIndicator />}
      <Text selectable style={[styles.mono, styles.centerText]}>{address}</Text>
    </ScrollView>
  );
}

function KhieScreen({
  state,
  pairing,
  onScan,
  onPair,
  onCancelPairing,
  onRetryRelay,
  onUnpair,
}: {
  state: KhieProviderSessionState;
  pairing: boolean;
  onScan: () => void;
  onPair: (endpoint: string) => Promise<boolean>;
  onCancelPairing: () => void;
  onRetryRelay: () => Promise<boolean>;
  onUnpair: () => Promise<void>;
}) {
  const [endpoint, setEndpoint] = useState("");
  const pair = async () => {
    if (await onPair(endpoint)) {
      setEndpoint("");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.khiePage} keyboardShouldPersistTaps="handled">
      <View style={styles.khieTitleRow}>
        <View style={styles.flex}>
          <Text style={styles.heading}>Khie</Text>
          <Text style={styles.muted}>P2P 钱包连接</Text>
        </View>
        <ConnectionState
          ready={state.paired ? state.remotePeer?.active === true : state.ready && state.relayConnected}
          label={
            state.paired
              ? state.remotePeer?.active
                ? "已连接"
                : "已配对"
              : state.relayConnected
                ? "可连接"
                : "准备中"
          }
        />
      </View>

      {pairing ? (
        <Surface elevation={1} style={[styles.khieCard, styles.pairingProgress]}>
          <ActivityIndicator size="large" />
          <Text style={styles.khieSectionTitle}>正在建立安全连接…</Text>
          <Text style={[styles.muted, styles.centerText]}>请保持当前页面打开</Text>
          <SecondaryButton label="取消配对" onPress={onCancelPairing} />
        </Surface>
      ) : state.paired ? (
        <Surface elevation={1} style={styles.khieCard}>
          <View style={styles.khieSectionHeader}>
            <View style={styles.flex}>
              <Text style={styles.khieSectionTitle}>已连接</Text>
              <Text style={styles.muted}>网页可以发起查询与签名请求</Text>
            </View>
            <PaperButton compact mode="text" textColor={walletTheme.colors.error} onPress={() => void onUnpair()}>
              解除
            </PaperButton>
          </View>

          <View style={styles.peerDetails}>
            <View style={styles.peerSummary}>
              <ConnectionState
                ready={state.remotePeer?.active === true}
                label={state.remotePeer?.active ? "在线" : "离线"}
              />
              <Text style={styles.peerPath}>
                {state.remotePeer?.active
                  ? state.remotePeer.direct
                    ? "WebRTC 直连"
                    : "Relay 连接"
                  : "等待网页重连"}
              </Text>
            </View>
            <Text numberOfLines={1} style={styles.peerName}>
              {state.remotePeer?.name ?? "网页 Connector"}
            </Text>
            <Text selectable numberOfLines={2} style={styles.monoSmall}>
              {state.remotePeer?.id ?? "正在读取 peer 信息…"}
            </Text>
            {state.remotePeer?.agentVersion ? (
              <Text numberOfLines={1} style={styles.peerAgent}>{state.remotePeer.agentVersion}</Text>
            ) : null}
          </View>

          <Surface elevation={0} style={styles.requestIdle}>
            <View style={styles.requestDot} />
            <View style={styles.flex}>
              <Text style={styles.requestTitle}>等待网页请求…</Text>
              <Text style={styles.requestHint}>连接、消息和交易签名都会单独确认</Text>
            </View>
          </Surface>
        </Surface>
      ) : (
        <Surface elevation={1} style={styles.khieCard}>
          <View>
            <Text style={styles.khieSectionTitle}>连接网页</Text>
            <Text style={styles.muted}>以下两种配对方式完全等价</Text>
          </View>

          <View style={styles.pairingMethod}>
            <Text style={styles.methodEyebrow}>方式一 · 网页扫手机</Text>
            {state.endpoint ? (
              <>
                <View style={styles.compactQrCard}>
                  <QRCode value={state.endpoint} size={142} />
                </View>
                <Text selectable numberOfLines={2} style={styles.endpointCopy}>
                  {state.endpoint}
                </Text>
              </>
            ) : (
              <View style={styles.qrPendingCard}>
                <ActivityIndicator />
                <Text style={styles.muted}>
                  {state.relayConnected ? "正在生成配对码…" : "正在连接 Relay…"}
                </Text>
                {state.ready && !state.relayConnected ? (
                  <Pressable onPress={() => void onRetryRelay()}>
                    <Text style={styles.retryText}>重试 Relay</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>

          <View style={styles.orDivider}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>或</Text>
            <View style={styles.orLine} />
          </View>

          <View style={styles.pairingMethod}>
            <Text style={styles.methodEyebrow}>方式二 · 手机扫网页</Text>
            <PrimaryButton label="扫描 Connector 配对码" onPress={onScan} />
            <View style={styles.pasteRow}>
              <WalletTextInput
                dense
                style={styles.pasteInput}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="或粘贴 role=connector 配对地址"
                value={endpoint}
                onChangeText={setEndpoint}
              />
              <PaperButton
                compact
                mode="contained-tonal"
                style={styles.pasteButton}
                disabled={!endpoint.trim()}
                onPress={() => void pair()}
              >
                连接
              </PaperButton>
            </View>
          </View>
        </Surface>
      )}

      {state.error && !pairing ? (
        <HelperText type="error" visible style={styles.khieError}>
          {formatKhieError(state.error)}
        </HelperText>
      ) : null}
    </ScrollView>
  );
}

function ScannerScreen({ onCancel, onScanned }: { onCancel: () => void; onScanned: (value: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  if (!permission) {
    return <View style={[styles.page, styles.center]}><ActivityIndicator /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={[styles.page, styles.center]}>
        <Text style={styles.centerText}>需要相机权限扫描 Khie 配对二维码。</Text>
        <PrimaryButton label="允许相机" onPress={() => void requestPermission()} />
        <SecondaryButton label="返回" onPress={onCancel} />
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
        <Text style={styles.scanText}>扫描 role=connector 的 Khie 二维码</Text>
        <SecondaryButton label="取消" onPress={onCancel} />
      </View>
    </View>
  );
}

function SettingsScreen({
  backend,
  profile,
  vault,
  onRecovered,
}: {
  backend: LocalMnemonicSigningBackend;
  profile: WalletProfile;
  vault: SecureStoreWalletVault;
  onRecovered: (profile: WalletProfile) => void;
}) {
  const [secret, setSecret] = useState<{ label: string; value: string }>();
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryMnemonic, setRecoveryMnemonic] = useState("");
  const [recovering, setRecovering] = useState(false);
  const reveal = async (kind: "mnemonic" | "privateKey") => {
    try {
      setSecret({
        label: kind === "mnemonic" ? "助记词" : "私钥",
        value: kind === "mnemonic" ? await backend.exportMnemonic() : await backend.exportPrivateKey(),
      });
    } catch (cause) {
      Alert.alert("无法显示", errorMessage(cause));
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.heading}>设置与导出</Text>
      <Card>
        <Text style={styles.label}>派生路径</Text>
        <Text selectable style={styles.mono}>{profile.derivationPath}</Text>
        <Text style={styles.label}>公钥</Text>
        <Text selectable style={styles.mono}>{profile.publicKey}</Text>
      </Card>
      <PrimaryButton label="认证并查看助记词" onPress={() => void reveal("mnemonic")} />
      <SecondaryButton label="认证并查看私钥" onPress={() => void reveal("privateKey")} />
      {secret ? (
        <Card>
          <Text style={styles.label}>{secret.label}</Text>
          <Text selectable style={styles.secret}>{secret.value}</Text>
          <SecondaryButton label="隐藏" onPress={() => setSecret(undefined)} />
        </Card>
      ) : null}
      <Text style={styles.warning}>导出内容不会持久化到页面状态之外；离开本页前请隐藏。</Text>
      <Text style={styles.sectionTitle}>密钥恢复</Text>
      <Text style={styles.muted}>系统认证条目失效时，可用原助记词重新写入 Android Keystore。</Text>
      <SecondaryButton
        label={showRecovery ? "取消恢复" : "用助记词恢复密钥"}
        onPress={() => {
          setShowRecovery((value) => !value);
          setRecoveryMnemonic("");
        }}
      />
      {showRecovery ? (
        <>
          <WalletTextInput
            style={[styles.input, styles.mnemonicInput]}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="输入 12 或 24 词英文助记词"
            value={recoveryMnemonic}
            onChangeText={setRecoveryMnemonic}
          />
          <PrimaryButton
            label={recovering ? "恢复中…" : "验证并恢复"}
            disabled={recovering || !recoveryMnemonic.trim()}
            onPress={() => {
              setRecovering(true);
              void persistWallet(vault, recoveryMnemonic)
                .then((next) => {
                  setSecret(undefined);
                  setRecoveryMnemonic("");
                  setShowRecovery(false);
                  onRecovered(next);
                })
                .catch((cause: unknown) => Alert.alert("恢复失败", errorMessage(cause)))
                .finally(() => setRecovering(false));
            }}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

function ApprovalModal({
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
  const [fee, setFee] = useState<string>();
  useEffect(() => {
    setFee(undefined);
    if (item?.request.method !== "sign_transaction" || !signer) return;
    let active = true;
    void item.request.transaction
      .getFee(signer.client)
      .then((value) => active && setFee(`${fixedPointToString(value)} CKB`))
      .catch(() => active && setFee("无法解析"));
    return () => {
      active = false;
    };
  }, [item, signer]);
  if (!item) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => onRespond(false)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.heading}>{approvalTitle(item.request)}</Text>
          <Text style={styles.label}>网络</Text>
          <Text>{approvalNetwork(item.request, network)}</Text>
          <ApprovalDetails request={item.request} fee={fee} />
          <View style={styles.row}>
            <View style={styles.flex}><SecondaryButton label="拒绝" onPress={() => onRespond(false)} danger /></View>
            <View style={styles.flex}><PrimaryButton label="允许" onPress={() => onRespond(true)} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ApprovalDetails({ request, fee }: { request: SignerJsonRpcConfirmation; fee?: string }) {
  if (request.method === "connect") {
    return <Text style={styles.muted}>网页将可以读取地址，并继续发起需要单独确认的签名请求。</Text>;
  }
  if (request.method === "sign_message") {
    return (
      <Card>
        <Text style={styles.label}>消息</Text>
        <Text selectable style={styles.secret}>{request.message.value}</Text>
      </Card>
    );
  }
  const tx = request.transaction;
  return (
    <Card>
      <Text style={styles.label}>交易哈希</Text>
      <Text selectable style={styles.monoSmall}>{tx.hash()}</Text>
      <Text>输入：{tx.inputs.length}</Text>
      <Text>输出：{tx.outputs.length}</Text>
      {tx.outputs.slice(0, 6).map((output, index) => (
        <Text key={index} style={styles.monoSmall}>#{index + 1} {fixedPointToString(output.capacity)} CKB · {output.lock.codeHash.slice(0, 14)}…</Text>
      ))}
      <Text style={styles.label}>手续费</Text>
      <Text>{fee ?? "正在解析…"}</Text>
    </Card>
  );
}

function approvalTitle(request: SignerJsonRpcConfirmation) {
  if (request.method === "connect") return "网页请求连接";
  if (request.method === "sign_message") return "确认消息签名";
  return "确认交易签名";
}

function approvalNetwork(request: SignerJsonRpcConfirmation, fallback: Network) {
  if (request.method === "connect") {
    if (request.networkId === "ckb-mainnet") return "CKB 主网";
    if (request.networkId === "ckb-testnet") return "CKB 测试网";
    return request.networkId;
  }
  return fallback === "mainnet" ? "CKB 主网" : "CKB 测试网";
}

function NetworkSwitch({ value, onChange }: { value: Network; onChange: (network: Network) => void }) {
  return (
    <SegmentedButtons
      density="small"
      value={value}
      onValueChange={(next) => onChange(next as Network)}
      buttons={[
        { value: "testnet", label: "测试网", showSelectedCheck: false },
        { value: "mainnet", label: "主网", showSelectedCheck: false },
      ]}
      style={styles.networkSwitch}
    />
  );
}

function BottomBar({ current, onNavigate }: { current: Screen; onNavigate: (screen: Screen) => void }) {
  const routes = [
    { key: "home", title: "账户", focusedIcon: "wallet", unfocusedIcon: "wallet-outline" },
    { key: "khie", title: "Khie", focusedIcon: "connection", unfocusedIcon: "connection" },
    { key: "settings", title: "设置", focusedIcon: "cog", unfocusedIcon: "cog-outline" },
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

function Card({ children }: { children: React.ReactNode }) {
  return (
    <PaperCard mode="outlined" style={styles.paperCard}>
      <PaperCard.Content style={styles.paperCardContent}>{children}</PaperCard.Content>
    </PaperCard>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <PaperButton
      mode="contained"
      disabled={disabled}
      onPress={onPress}
      style={styles.paperButton}
      contentStyle={styles.paperButtonContent}
      labelStyle={styles.paperButtonLabel}
    >
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
      style={[styles.paperButton, danger && { borderColor: theme.colors.error }]}
      contentStyle={styles.paperButtonContent}
      labelStyle={styles.paperButtonLabel}
    >
      {label}
    </PaperButton>
  );
}

function WalletTextInput(props: React.ComponentProps<typeof PaperTextInput>) {
  return <PaperTextInput mode="outlined" {...props} />;
}

function BackButton({ onPress }: { onPress: () => void }) {
  return <Pressable onPress={onPress}><Text style={styles.back}>‹ 返回</Text></Pressable>;
}

function ConnectionState({ label, ready }: { label: string; ready: boolean }) {
  return (
    <Chip
      compact
      mode="outlined"
      avatar={<View style={[styles.connectionDot, ready && styles.connectionDotReady]} />}
      style={styles.connectionState}
      textStyle={styles.connectionLabel}
    >
      {label}
    </Chip>
  );
}

function Notice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <Portal>
      <Snackbar
        visible
        onDismiss={onDismiss}
        action={{ label: "关闭", onPress: onDismiss }}
        wrapperStyle={styles.snackbar}
      >
        {text}
      </Snackbar>
    </Portal>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "操作失败";
}

function formatKhieError(message: string): string {
  if (message.startsWith("Expected a connector pairing endpoint")) {
    return "这不是网页 Connector 的配对码，请扫描网页端生成的二维码。";
  }
  if (message === "Pairing endpoint is not a valid URL") {
    return "配对地址不是有效链接。";
  }
  if (message === "Pairing endpoint is incomplete") {
    return "配对地址不完整，请重新扫描或粘贴。";
  }
  if (message === "Pairing endpoint contains invalid compressed addresses") {
    return "配对地址已损坏或与当前 Khie 版本不兼容。";
  }
  return message;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: walletTheme.colors.background },
  body: { flex: 1 },
  page: { padding: 20, gap: 16 },
  center: { justifyContent: "center", alignItems: "center" },
  centerText: { textAlign: "center" },
  appHeader: { paddingHorizontal: 4, backgroundColor: walletTheme.colors.surface },
  appTitle: { fontSize: 20, fontWeight: "700" },
  hero: { fontSize: 34, fontWeight: "800", color: walletTheme.colors.onBackground },
  heading: { fontSize: 25, fontWeight: "700", color: walletTheme.colors.onBackground },
  subtitle: { fontSize: 16, color: walletTheme.colors.onSurfaceVariant, marginBottom: 18 },
  muted: { color: walletTheme.colors.onSurfaceVariant },
  warning: { color: walletTheme.colors.error, lineHeight: 20 },
  networkLabel: { textAlign: "center", color: walletTheme.colors.onSurfaceVariant },
  balance: { textAlign: "center", fontSize: 44, fontWeight: "700", color: walletTheme.colors.onBackground },
  unit: { textAlign: "center", marginTop: -14, color: walletTheme.colors.onSurfaceVariant },
  paperCard: { backgroundColor: walletTheme.colors.surface },
  paperCardContent: { gap: 10, paddingVertical: 2 },
  qrCard: { backgroundColor: walletTheme.colors.surface, borderRadius: 14, padding: 18, alignSelf: "center" },
  label: { fontSize: 13, fontWeight: "600", color: walletTheme.colors.onSurfaceVariant, marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginTop: 10 },
  mono: { fontFamily: "monospace", lineHeight: 21 },
  monoSmall: { fontFamily: "monospace", fontSize: 12, lineHeight: 17 },
  secret: { fontFamily: "monospace", lineHeight: 22, color: walletTheme.colors.onSurface },
  input: { backgroundColor: walletTheme.colors.surface, fontSize: 16 },
  mnemonicInput: { minHeight: 150, textAlignVertical: "top" },
  endpointInput: { minHeight: 90, textAlignVertical: "top", fontSize: 12 },
  words: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  word: { width: "31%", flexDirection: "row", gap: 6, backgroundColor: "white", padding: 10, borderRadius: 8 },
  wordIndex: { color: "#8a93a3", fontSize: 12 },
  paperButton: { alignSelf: "stretch" },
  paperButtonContent: { minHeight: 48 },
  paperButtonLabel: { fontSize: 15, fontWeight: "700" },
  dangerText: { color: walletTheme.colors.error },
  disabled: { opacity: 0.45 },
  back: { fontSize: 16, color: walletTheme.colors.primary },
  networkSwitch: { width: 170, marginRight: 8 },
  khiePage: { padding: 20, gap: 14 },
  khieTitleRow: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  connectionState: { alignSelf: "flex-start", backgroundColor: walletTheme.colors.surface },
  connectionDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: walletTheme.colors.outline },
  connectionDotReady: { backgroundColor: walletSemanticColors.success },
  connectionLabel: { color: walletTheme.colors.onSurfaceVariant, fontSize: 12, fontWeight: "600" },
  khieCard: { gap: 12, borderRadius: 16, backgroundColor: walletTheme.colors.surface, padding: 16 },
  khieSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  khieSectionTitle: { color: walletTheme.colors.onSurface, fontSize: 18, fontWeight: "700", marginBottom: 3 },
  pairingProgress: { minHeight: 300, alignItems: "center", justifyContent: "center" },
  pairingMethod: { gap: 9 },
  methodEyebrow: { color: "#596273", fontSize: 12, fontWeight: "700" },
  compactQrCard: { width: 158, height: 158, alignSelf: "center", alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: walletTheme.colors.outlineVariant, borderRadius: 12, backgroundColor: "white" },
  endpointCopy: { minHeight: 31, color: "#7a8495", fontFamily: "monospace", fontSize: 9, lineHeight: 13, textAlign: "center" },
  qrPendingCard: { height: 189, alignItems: "center", justifyContent: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: "#e0e5ed", borderRadius: 10, backgroundColor: "#f9fafb" },
  retryText: { color: "#2563eb", fontSize: 13, fontWeight: "700" },
  orDivider: { height: 17, flexDirection: "row", alignItems: "center", gap: 9 },
  orLine: { height: StyleSheet.hairlineWidth, flex: 1, backgroundColor: "#d5dae3" },
  orText: { color: "#98a1b0", fontSize: 11 },
  pasteRow: { flexDirection: "row", gap: 8 },
  pasteInput: { height: 44, flex: 1, minWidth: 0, backgroundColor: walletTheme.colors.surface, fontFamily: "monospace", fontSize: 10 },
  pasteButton: { minWidth: 70, alignSelf: "stretch", justifyContent: "center" },
  peerDetails: { gap: 10, borderRadius: 12, backgroundColor: walletTheme.colors.surfaceVariant, padding: 13 },
  peerSummary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  peerPath: { color: "#596273", fontSize: 12, fontWeight: "600" },
  peerName: { color: "#111827", fontSize: 14, fontWeight: "700" },
  peerAgent: { color: "#7a8495", fontSize: 10 },
  requestIdle: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, backgroundColor: walletTheme.colors.surfaceVariant, padding: 14 },
  requestDot: { width: 9, height: 9, borderRadius: 99, backgroundColor: walletSemanticColors.success },
  requestTitle: { color: "#111827", fontSize: 14, fontWeight: "700" },
  requestHint: { color: "#7a8495", fontSize: 11, lineHeight: 16, marginTop: 2 },
  khieError: { fontSize: 12, lineHeight: 17 },
  snackbar: { marginBottom: 88 },
  scanner: { flex: 1, backgroundColor: "black" },
  scanGuide: { position: "absolute", width: 250, height: 250, borderWidth: 3, borderColor: "white", borderRadius: 20, alignSelf: "center", top: "25%" },
  scanFooter: { position: "absolute", left: 20, right: 20, bottom: 30, gap: 12 },
  scanText: { color: "white", textAlign: "center", fontSize: 16 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  modalCard: { maxHeight: "82%", backgroundColor: "white", padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, gap: 14 },
  row: { flexDirection: "row", gap: 12 },
  flex: { flex: 1 },
} as const);
