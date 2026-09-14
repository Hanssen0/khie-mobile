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
  Alert,
  AppState,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  ActivityIndicator,
  Appbar,
  BottomNavigation,
  Button as PaperButton,
  Card as PaperCard,
  Chip,
  Dialog,
  Divider,
  HelperText,
  Icon,
  List,
  PaperProvider,
  Portal,
  SegmentedButtons,
  Snackbar,
  Text,
  TextInput as PaperTextInput,
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
import { walletTheme } from "./src/theme";

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
      <Appbar.Header statusBarHeight={0}>
        <Appbar.Content title="Khie Wallet" />
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
      <Text variant="bodyLarge">正在读取钱包资料…</Text>
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
        <Icon source="wallet" size={64} color={walletTheme.colors.primary} />
        <Text variant="displaySmall">Khie Wallet</Text>
        <Text variant="bodyLarge" style={styles.centerText}>一个简单的 CKB 钱包与 Khie Provider</Text>
        <PrimaryButton label="创建新钱包" onPress={() => void beginCreate()} disabled={busy} />
        <SecondaryButton label="恢复钱包" onPress={() => onMode("restore")} />
        <HelperText type="error" visible style={styles.centerText}>
          开发版本，未经安全审计。主网使用风险由使用者承担。
        </HelperText>
      </View>
    );
  }

  if (mode === "restore") {
    return (
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <BackButton onPress={() => onMode("start")} />
        <Text variant="headlineMedium">恢复钱包</Text>
        <Text variant="bodyMedium">输入 12 或 24 词英文 BIP-39 助记词。</Text>
        <WalletTextInput
          style={styles.mnemonicInput}
          multiline
          label="助记词"
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
      <Text variant="headlineMedium">备份助记词</Text>
      <HelperText type="error" visible>
        按顺序抄写。任何人拿到这些词都可以控制钱包。
      </HelperText>
      <View style={styles.words}>
        {words.map((word, index) => (
          <Chip key={`${word}-${index}`} compact mode="flat">
            {index + 1}. {word}
          </Chip>
        ))}
      </View>
      <WalletTextInput label="输入第 3 个词" autoCapitalize="none" value={word3} onChangeText={setWord3} />
      <WalletTextInput label="输入第 9 个词" autoCapitalize="none" value={word9} onChangeText={setWord9} />
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
      <View style={styles.balanceBlock}>
        <Text variant="labelLarge">{network === "testnet" ? "CKB 测试网" : "CKB 主网"}</Text>
        <Text variant="displayMedium">{balance}</Text>
        <Text variant="titleMedium">CKB</Text>
      </View>
      <PaperCard mode="outlined">
        <PaperCard.Title title="钱包地址" left={(props) => <Icon {...props} source="identifier" />} />
        <PaperCard.Content>
          <Text variant="bodyMedium" selectable style={styles.mono}>{address}</Text>
        </PaperCard.Content>
        <PaperCard.Actions>
          <PaperButton icon="refresh" loading={refreshing} disabled={refreshing} onPress={() => void refresh()}>
            刷新
          </PaperButton>
          <PaperButton icon="qrcode" mode="contained" onPress={() => onNavigate("receive")}>
            收款
          </PaperButton>
        </PaperCard.Actions>
      </PaperCard>
    </ScrollView>
  );
}

function ReceiveScreen({ signer, onBack }: { signer?: Signer; onBack: () => void }) {
  const [address, setAddress] = useState("");
  useEffect(() => {
    void signer?.getRecommendedAddress().then(setAddress);
  }, [signer]);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <BackButton onPress={onBack} />
      <Text variant="headlineMedium">收款</Text>
      <PaperCard mode="elevated">
        <PaperCard.Content style={styles.qrContent}>
          {address ? <QRCode value={address} size={230} /> : <ActivityIndicator />}
          <Text variant="bodyMedium" selectable style={[styles.mono, styles.centerText]}>{address}</Text>
        </PaperCard.Content>
      </PaperCard>
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

  const remoteActive = state.remotePeer?.active === true;
  const connectionPath = remoteActive
    ? state.remotePeer?.direct
      ? "WebRTC 直连"
      : "Relay 连接"
    : "等待网页重连";

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.screenTitleRow}>
        <View style={styles.flex}>
          <Text variant="headlineMedium">Khie</Text>
          <Text variant="bodyMedium">P2P 钱包连接</Text>
        </View>
        <ConnectionState
          ready={state.paired ? remoteActive : state.ready && state.relayConnected}
          label={
            state.paired
              ? remoteActive
                ? "已连接"
                : "已配对"
              : state.relayConnected
                ? "可连接"
                : "准备中"
          }
        />
      </View>

      {pairing ? (
        <PaperCard mode="elevated">
          <PaperCard.Content style={styles.pairingProgress}>
            <ActivityIndicator size="large" />
            <Text variant="titleLarge">正在建立安全连接</Text>
            <Text variant="bodyMedium">请保持当前页面打开</Text>
            <PaperButton mode="text" onPress={onCancelPairing}>取消配对</PaperButton>
          </PaperCard.Content>
        </PaperCard>
      ) : state.paired ? (
        <PaperCard mode="elevated">
          <PaperCard.Title
            title={state.remotePeer?.name ?? "网页 Connector"}
            subtitle={connectionPath}
            left={(props) => <Icon {...props} source="web" />}
          />
          <PaperCard.Content style={styles.cardContent}>
            <List.Item
              title={remoteActive ? "网页在线" : "网页离线"}
              description={remoteActive ? "可以发起查询和签名请求" : "Connector 重拨后会自动恢复"}
              left={(props) => <List.Icon {...props} icon={remoteActive ? "check-circle" : "progress-clock"} />}
            />
            <Divider />
            <View style={styles.metadataBlock}>
              <Text variant="labelMedium">Peer ID</Text>
              <Text variant="bodySmall" selectable numberOfLines={2} style={styles.mono}>
                {state.remotePeer?.id ?? "正在读取 peer 信息…"}
              </Text>
              {state.remotePeer?.agentVersion ? (
                <Text variant="labelSmall" numberOfLines={1}>{state.remotePeer.agentVersion}</Text>
              ) : null}
            </View>
            <Divider />
            <List.Item
              title="等待网页请求"
              description="连接、消息和交易签名都会单独确认"
              left={(props) => <List.Icon {...props} icon="shield-check" />}
            />
          </PaperCard.Content>
          <PaperCard.Actions>
            <PaperButton icon="link-off" textColor={walletTheme.colors.error} onPress={() => void onUnpair()}>
              解除配对
            </PaperButton>
          </PaperCard.Actions>
        </PaperCard>
      ) : (
        <PaperCard mode="elevated">
          <PaperCard.Title
            title="连接网页"
            subtitle="选择任意一种方式，结果完全相同"
            left={(props) => <Icon {...props} source="connection" />}
          />
          <PaperCard.Content style={styles.cardContent}>
            <Text variant="titleSmall">网页扫描手机</Text>
            {state.endpoint ? (
              <>
                <View style={styles.qrFrame}>
                  <QRCode value={state.endpoint} size={142} />
                </View>
                <Text variant="labelSmall" selectable numberOfLines={2} style={[styles.mono, styles.centerText]}>
                  {state.endpoint}
                </Text>
              </>
            ) : (
              <View style={styles.qrPlaceholder}>
                <ActivityIndicator />
                <Text variant="bodyMedium">
                  {state.relayConnected ? "正在生成配对码…" : "正在连接 Relay…"}
                </Text>
                {state.ready && !state.relayConnected ? (
                  <PaperButton icon="refresh" onPress={() => void onRetryRelay()}>重试 Relay</PaperButton>
                ) : null}
              </View>
            )}
            <Divider />
            <Text variant="titleSmall">手机扫描网页</Text>
            <PaperButton mode="contained" icon="qrcode-scan" onPress={onScan}>
              扫描 Connector 配对码
            </PaperButton>
            <WalletTextInput
              dense
              label="Connector 配对地址"
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
          </PaperCard.Content>
        </PaperCard>
      )}

      {state.error && !pairing ? (
        <HelperText type="error" visible>
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
        <Icon source="camera" size={48} color={walletTheme.colors.primary} />
        <Text variant="titleLarge" style={styles.centerText}>需要相机权限</Text>
        <Text variant="bodyMedium" style={styles.centerText}>用于扫描 Khie 配对二维码。</Text>
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
        <Text variant="titleMedium" style={styles.scanText}>扫描 role=connector 的 Khie 二维码</Text>
        <PaperButton mode="contained-tonal" icon="close" onPress={onCancel}>取消</PaperButton>
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
      <Text variant="headlineMedium">设置与导出</Text>
      <PaperCard mode="outlined">
        <PaperCard.Title title="账户信息" left={(props) => <Icon {...props} source="account-key" />} />
        <PaperCard.Content style={styles.cardContent}>
          <View style={styles.metadataBlock}>
            <Text variant="labelMedium">派生路径</Text>
            <Text variant="bodyMedium" selectable style={styles.mono}>{profile.derivationPath}</Text>
          </View>
          <Divider />
          <View style={styles.metadataBlock}>
            <Text variant="labelMedium">公钥</Text>
            <Text variant="bodySmall" selectable style={styles.mono}>{profile.publicKey}</Text>
          </View>
        </PaperCard.Content>
        <PaperCard.Actions>
          <PaperButton icon="eye-lock" onPress={() => void reveal("privateKey")}>查看私钥</PaperButton>
          <PaperButton mode="contained" icon="eye-lock" onPress={() => void reveal("mnemonic")}>查看助记词</PaperButton>
        </PaperCard.Actions>
      </PaperCard>
      {secret ? (
        <PaperCard mode="contained">
          <PaperCard.Title title={secret.label} left={(props) => <Icon {...props} source="shield-key" />} />
          <PaperCard.Content>
            <Text variant="bodyMedium" selectable style={styles.mono}>{secret.value}</Text>
          </PaperCard.Content>
          <PaperCard.Actions>
            <PaperButton icon="eye-off" onPress={() => setSecret(undefined)}>隐藏</PaperButton>
          </PaperCard.Actions>
        </PaperCard>
      ) : null}
      <HelperText type="error" visible>
        导出内容只保留在当前页面；离开前请隐藏。
      </HelperText>
      <PaperCard mode="outlined">
        <PaperCard.Title
          title="密钥恢复"
          left={(props) => <Icon {...props} source="backup-restore" />}
        />
        <PaperCard.Content style={styles.cardContent}>
          <Text variant="bodyMedium">
            系统认证条目失效时，用原助记词重新写入 Android Keystore。
          </Text>
          {showRecovery ? (
            <WalletTextInput
              style={styles.mnemonicInput}
              multiline
              label="助记词"
              autoCapitalize="none"
              autoCorrect={false}
              value={recoveryMnemonic}
              onChangeText={setRecoveryMnemonic}
            />
          ) : null}
        </PaperCard.Content>
        <PaperCard.Actions>
          <PaperButton
            icon={showRecovery ? "close" : "key-variant"}
            onPress={() => {
              setShowRecovery((value) => !value);
              setRecoveryMnemonic("");
            }}
          >
            {showRecovery ? "取消" : "用助记词恢复"}
          </PaperButton>
          {showRecovery ? (
            <PaperButton
              mode="contained"
              icon="restore"
              loading={recovering}
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
            >
              验证并恢复
            </PaperButton>
          ) : null}
        </PaperCard.Actions>
      </PaperCard>
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
    <Portal>
      <Dialog visible onDismiss={() => onRespond(false)}>
        <Dialog.Icon icon={approvalIcon(item.request)} />
        <Dialog.Title>{approvalTitle(item.request)}</Dialog.Title>
        <Dialog.ScrollArea style={styles.dialogScrollArea}>
          <ScrollView contentContainerStyle={styles.dialogContent}>
            <View style={styles.metadataBlock}>
              <Text variant="labelMedium">网络</Text>
              <Text variant="bodyLarge">{approvalNetwork(item.request, network)}</Text>
            </View>
            <Divider />
          <ApprovalDetails request={item.request} fee={fee} />
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <PaperButton textColor={walletTheme.colors.error} onPress={() => onRespond(false)}>拒绝</PaperButton>
          <PaperButton mode="contained" onPress={() => onRespond(true)}>允许</PaperButton>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

function ApprovalDetails({ request, fee }: { request: SignerJsonRpcConfirmation; fee?: string }) {
  if (request.method === "connect") {
    return <Text variant="bodyMedium">网页将可以读取地址，并继续发起需要单独确认的签名请求。</Text>;
  }
  if (request.method === "sign_message") {
    return (
      <PaperCard mode="contained">
        <PaperCard.Title title="消息" />
        <PaperCard.Content>
          <Text variant="bodyMedium" selectable style={styles.mono}>{request.message.value}</Text>
        </PaperCard.Content>
      </PaperCard>
    );
  }
  const tx = request.transaction;
  return (
    <PaperCard mode="contained">
      <PaperCard.Title title="交易摘要" />
      <PaperCard.Content style={styles.cardContent}>
        <View style={styles.metadataBlock}>
          <Text variant="labelMedium">交易哈希</Text>
          <Text variant="bodySmall" selectable style={styles.mono}>{tx.hash()}</Text>
        </View>
        <List.Item title={`${tx.inputs.length} 个输入`} left={(props) => <List.Icon {...props} icon="import" />} />
        <List.Item title={`${tx.outputs.length} 个输出`} left={(props) => <List.Icon {...props} icon="export" />} />
        {tx.outputs.slice(0, 6).map((output, index) => (
          <Text key={index} variant="bodySmall" style={styles.mono}>
            #{index + 1} {fixedPointToString(output.capacity)} CKB · {output.lock.codeHash.slice(0, 14)}…
          </Text>
        ))}
        <Divider />
        <View style={styles.metadataBlock}>
          <Text variant="labelMedium">手续费</Text>
          <Text variant="bodyLarge">{fee ?? "正在解析…"}</Text>
        </View>
      </PaperCard.Content>
    </PaperCard>
  );
}

function approvalIcon(request: SignerJsonRpcConfirmation) {
  if (request.method === "connect") return "link-variant";
  if (request.method === "sign_message") return "message-text-lock";
  return "file-sign";
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

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <PaperButton mode="contained" disabled={disabled} onPress={onPress}>
      {label}
    </PaperButton>
  );
}

function SecondaryButton({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <PaperButton
      mode="outlined"
      disabled={disabled}
      onPress={onPress}
      textColor={danger ? walletTheme.colors.error : undefined}
    >
      {label}
    </PaperButton>
  );
}

function WalletTextInput(props: React.ComponentProps<typeof PaperTextInput>) {
  return <PaperTextInput mode="outlined" {...props} />;
}

function BackButton({ onPress }: { onPress: () => void }) {
  return <PaperButton compact icon="arrow-left" onPress={onPress} style={styles.backButton}>返回</PaperButton>;
}

function ConnectionState({ label, ready }: { label: string; ready: boolean }) {
  return (
    <Chip compact mode={ready ? "flat" : "outlined"} icon={ready ? "check-circle" : "progress-clock"}>
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
  center: { justifyContent: "center", alignItems: "center", gap: 16 },
  centerText: { textAlign: "center" },
  screenTitleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  balanceBlock: { alignItems: "center", gap: 4, paddingVertical: 24 },
  cardContent: { gap: 12 },
  metadataBlock: { gap: 4 },
  mono: { fontFamily: "monospace" },
  mnemonicInput: { minHeight: 144, textAlignVertical: "top" },
  words: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  backButton: { alignSelf: "flex-start", marginLeft: -12 },
  networkSwitch: { width: 170, marginRight: 8 },
  pairingProgress: { minHeight: 320, alignItems: "center", justifyContent: "center", gap: 16 },
  qrContent: { alignItems: "center", gap: 16, paddingBottom: 24 },
  qrFrame: { alignSelf: "center", padding: 12, borderRadius: walletTheme.roundness * 4, backgroundColor: "white" },
  qrPlaceholder: { height: 166, alignItems: "center", justifyContent: "center", gap: 12 },
  dialogScrollArea: { maxHeight: 480, paddingHorizontal: 0 },
  dialogContent: { gap: 16, paddingHorizontal: 24, paddingVertical: 16 },
  snackbar: { marginBottom: 88 },
  scanner: { flex: 1, backgroundColor: "black" },
  scanGuide: { position: "absolute", width: 250, height: 250, borderWidth: 3, borderColor: "white", borderRadius: walletTheme.roundness * 5, alignSelf: "center", top: "25%" },
  scanFooter: { position: "absolute", left: 20, right: 20, bottom: 30, gap: 12 },
  scanText: { color: "white", textAlign: "center" },
  flex: { flex: 1 },
} as const);
