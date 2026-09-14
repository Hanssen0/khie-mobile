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
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

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

type Screen = "home" | "receive" | "khie" | "settings" | "scanner";
type Onboarding = "start" | "create" | "restore";

const endpointUrl = "https://app.ckbccc.com/khie";

export default function App() {
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
      <View style={styles.appHeader}>
        <Text style={styles.appTitle}>Khie Wallet</Text>
        <NetworkSwitch value={network} onChange={changeNetwork} />
      </View>
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
            onScan={() => setScreen("scanner")}
            onPair={(value) => sessionRef.current?.pair(value) ?? Promise.resolve(false)}
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
              void sessionRef.current?.pair(value);
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
        <TextInput
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
      <TextInput style={styles.input} autoCapitalize="none" value={word3} onChangeText={setWord3} />
      <Text style={styles.label}>输入第 9 个词</Text>
      <TextInput style={styles.input} autoCapitalize="none" value={word9} onChangeText={setWord9} />
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
  onScan,
  onPair,
  onUnpair,
}: {
  state: KhieProviderSessionState;
  onScan: () => void;
  onPair: (endpoint: string) => Promise<boolean>;
  onUnpair: () => Promise<void>;
}) {
  const [endpoint, setEndpoint] = useState("");
  const [pairing, setPairing] = useState(false);
  const pair = async () => {
    setPairing(true);
    await onPair(endpoint);
    setPairing(false);
  };
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Khie 连接</Text>
      <Card>
        <StatusRow label="节点" ok={state.ready} />
        <StatusRow label="Relay" ok={state.relayConnected} />
        <StatusRow label="已配对" ok={state.paired} />
        {state.remotePeer ? (
          <>
            <StatusRow label="在线" ok={state.remotePeer.active} />
            <StatusRow label="WebRTC 直连" ok={state.remotePeer.direct === true} />
            <Text style={styles.monoSmall}>{state.remotePeer.name ?? state.remotePeer.id}</Text>
          </>
        ) : null}
      </Card>
      {!state.paired ? (
        <>
          <PrimaryButton label="扫描网页 Connector 二维码" onPress={onScan} />
          <TextInput
            style={[styles.input, styles.endpointInput]}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="也可以粘贴 role=connector 的配对地址"
            value={endpoint}
            onChangeText={setEndpoint}
          />
          <SecondaryButton label={pairing ? "配对中…" : "连接粘贴的地址"} onPress={() => void pair()} disabled={!endpoint.trim() || pairing} />
          <Text style={styles.sectionTitle}>让网页扫描手机</Text>
          {state.endpoint ? (
            <View style={styles.qrCard}>
              <QRCode value={state.endpoint} size={220} />
            </View>
          ) : (
            <Text style={styles.muted}>Relay 准备好后会生成 Provider 二维码。</Text>
          )}
        </>
      ) : (
        <SecondaryButton label="解除配对" onPress={() => void onUnpair()} danger />
      )}
      {state.error ? <Text style={styles.warning}>{state.error}</Text> : null}
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
          <TextInput
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
    <View style={styles.segment}>
      <Pressable style={[styles.segmentItem, value === "testnet" && styles.segmentActive]} onPress={() => onChange("testnet")}>
        <Text style={value === "testnet" ? styles.segmentActiveText : undefined}>测试网</Text>
      </Pressable>
      <Pressable style={[styles.segmentItem, value === "mainnet" && styles.segmentActive]} onPress={() => onChange("mainnet")}>
        <Text style={value === "mainnet" ? styles.segmentActiveText : undefined}>主网</Text>
      </Pressable>
    </View>
  );
}

function BottomBar({ current, onNavigate }: { current: Screen; onNavigate: (screen: Screen) => void }) {
  const items: Array<[Screen, string]> = [["home", "账户"], ["khie", "Khie"], ["settings", "设置"]];
  return (
    <View style={styles.bottomBar}>
      {items.map(([screen, label]) => (
        <Pressable key={screen} style={styles.bottomItem} onPress={() => onNavigate(screen)}>
          <Text style={current === screen ? styles.bottomActive : styles.muted}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable style={[styles.button, disabled && styles.disabled]} onPress={onPress} disabled={disabled}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

function SecondaryButton({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return <Pressable style={[styles.secondaryButton, danger && styles.dangerButton, disabled && styles.disabled]} onPress={onPress} disabled={disabled}><Text style={[styles.secondaryText, danger && styles.dangerText]}>{label}</Text></Pressable>;
}

function BackButton({ onPress }: { onPress: () => void }) {
  return <Pressable onPress={onPress}><Text style={styles.back}>‹ 返回</Text></Pressable>;
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return <View style={styles.statusRow}><Text>{label}</Text><Text style={ok ? styles.ok : styles.muted}>{ok ? "已就绪" : "未就绪"}</Text></View>;
}

function Notice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return <Pressable style={styles.notice} onPress={onDismiss}><Text style={styles.noticeText}>{text}</Text></Pressable>;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "操作失败";
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f5f7fb" },
  body: { flex: 1 },
  page: { padding: 20, gap: 16 },
  center: { justifyContent: "center", alignItems: "center" },
  centerText: { textAlign: "center" },
  appHeader: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "white", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#d5dae3" },
  appTitle: { fontSize: 20, fontWeight: "700" },
  hero: { fontSize: 34, fontWeight: "800", color: "#111827" },
  heading: { fontSize: 25, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 16, color: "#596273", marginBottom: 18 },
  muted: { color: "#697386" },
  warning: { color: "#9a3412", lineHeight: 20 },
  networkLabel: { textAlign: "center", color: "#697386" },
  balance: { textAlign: "center", fontSize: 44, fontWeight: "700", color: "#111827" },
  unit: { textAlign: "center", marginTop: -14, color: "#697386" },
  card: { gap: 10, backgroundColor: "white", padding: 16, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: "#d5dae3" },
  qrCard: { backgroundColor: "white", borderRadius: 14, padding: 18, alignSelf: "center" },
  label: { fontSize: 13, fontWeight: "600", color: "#596273", marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginTop: 10 },
  mono: { fontFamily: "monospace", lineHeight: 21 },
  monoSmall: { fontFamily: "monospace", fontSize: 12, lineHeight: 17 },
  secret: { fontFamily: "monospace", lineHeight: 22, color: "#111827" },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#c8cfda", borderRadius: 10, backgroundColor: "white", padding: 12, fontSize: 16 },
  mnemonicInput: { minHeight: 150, textAlignVertical: "top" },
  endpointInput: { minHeight: 90, textAlignVertical: "top", fontSize: 12 },
  words: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  word: { width: "31%", flexDirection: "row", gap: 6, backgroundColor: "white", padding: 10, borderRadius: 8 },
  wordIndex: { color: "#8a93a3", fontSize: 12 },
  button: { minHeight: 50, justifyContent: "center", alignItems: "center", borderRadius: 11, paddingHorizontal: 18, backgroundColor: "#2563eb", alignSelf: "stretch" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "700" },
  secondaryButton: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: 11, borderWidth: 1, borderColor: "#9aa5b5", paddingHorizontal: 18, alignSelf: "stretch" },
  secondaryText: { color: "#253247", fontSize: 16, fontWeight: "600" },
  dangerButton: { borderColor: "#dc2626" },
  dangerText: { color: "#dc2626" },
  disabled: { opacity: 0.45 },
  back: { fontSize: 16, color: "#2563eb" },
  segment: { flexDirection: "row", backgroundColor: "#edf0f5", padding: 3, borderRadius: 9 },
  segmentItem: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7 },
  segmentActive: { backgroundColor: "white" },
  segmentActiveText: { color: "#111827", fontWeight: "700" },
  bottomBar: { flexDirection: "row", backgroundColor: "white", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#d5dae3", paddingBottom: 8 },
  bottomItem: { flex: 1, alignItems: "center", paddingVertical: 13 },
  bottomActive: { color: "#2563eb", fontWeight: "700" },
  statusRow: { flexDirection: "row", justifyContent: "space-between" },
  ok: { color: "#15803d", fontWeight: "600" },
  notice: { backgroundColor: "#fff7ed", padding: 12, borderBottomWidth: 1, borderBottomColor: "#fed7aa" },
  noticeText: { color: "#9a3412", textAlign: "center" },
  scanner: { flex: 1, backgroundColor: "black" },
  scanGuide: { position: "absolute", width: 250, height: 250, borderWidth: 3, borderColor: "white", borderRadius: 20, alignSelf: "center", top: "25%" },
  scanFooter: { position: "absolute", left: 20, right: 20, bottom: 30, gap: 12 },
  scanText: { color: "white", textAlign: "center", fontSize: 16 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  modalCard: { maxHeight: "82%", backgroundColor: "white", padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, gap: 14 },
  row: { flexDirection: "row", gap: 12 },
  flex: { flex: 1 },
} as const);
