import { type Signer } from "@ckb-ccc/core";
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationLightTheme,
  NavigationContainer,
  createNavigationContainerRef,
  type Theme as NavigationTheme,
} from "@react-navigation/native";
import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { type ReactNode, useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "react-native-paper";

import { LoadingScreen, Notice } from "./components";
import { HomeScreen, ReceiveScreen, SendScreen } from "./AccountScreens";
import { KhieScreen, ScannerScreen } from "./KhieScreen";
import { BottomBar } from "./navigation";
import { OnboardingScreen } from "./OnboardingScreen";
import { SettingsScreen } from "./SettingsScreen";
import { TrustDeviceScreen } from "./TrustDeviceScreen";
import { styles } from "./styles";
import type { Onboarding, Screen } from "./types";
import type { ApprovalItem } from "../khie/approvalQueue";
import type { KhieProviderSessionState } from "../khie/KhieProviderSession";
import type { TrustDevice } from "../trust/native";
import type { ThemePreference } from "../storage/themeSettings";
import type { UpdateSettings } from "../storage/updateSettings";
import type { SecureStoreWalletVault, WalletCredential } from "../storage/walletVault";
import type { LocalMnemonicSigningBackend } from "../wallet/localMnemonicBackend";
import type { NetworkRpcUrls } from "../wallet/network";
import type { Network, WalletProfile, WalletState } from "../wallet/types";
import type { ReleaseAsset } from "../update/githubRelease";

type TabRoute = "home" | "khie" | "trust" | "settings";
type RootRoutes = { tabs: { screen?: TabRoute } | undefined; receive: undefined; scanner: undefined; send: undefined; sendScanner: undefined };
const navigationRef = createNavigationContainerRef<RootRoutes>();
const Stack = createNativeStackNavigator<RootRoutes>();
const Tabs = createBottomTabNavigator<Record<TabRoute, undefined>>();
const screenRoutes = new Set<Screen>(["home", "receive", "send", "khie", "trust", "settings", "scanner"]);

type OnboardingRouteProps = {
  mode: Onboarding; vault: SecureStoreWalletVault; hasMasterPassword: boolean;
  onUnlockMasterPassword: () => Promise<WalletCredential>;
  onMode: (mode: Onboarding) => void;
  onComplete: (state: WalletState) => Promise<void> | void;
  onConnectTrust: (device: TrustDevice) => Promise<void>;
  onError: (cause: unknown) => void;
};

export function WalletRouter({
  loading, screen, profile, wallets, signer, network, onboarding, addingWallet, sessionState,
  pairing, approval, queuedApprovalCount, localBackend, rpcUrls, themePreference, updateSettings, checkingForUpdates,
  currentVersion, buildCommit, appArchitecture, updateAvailable, updateAsset,
  biometricAvailable, biometricUnlock, masterPasswordSet, notice, dialogs, onDismissNotice,
  onScreenChange, onFinishOnboarding, onCancelAddingWallet, onPairKhie, onCancelKhiePairing,
  onConnectRelay, onUnpairKhie, onRespondToApproval, onRefreshTrust, onGenerateTrustKey,
  onImportTrustKey, onResetTrustKey, onChangeNetwork, onChangeBiometricUnlock,
  onChangeMasterPassword, onAddWallet, onRemoveWallet, onSaveRpcUrls, onChangeThemePreference,
  onChangeAutomaticUpdateChecks, onCheckForUpdates, onDownloadUpdate,
  onSelectWallet,
}: {
  loading: boolean; screen: Screen; profile?: WalletProfile; wallets: WalletProfile[]; signer?: Signer;
  network: Network; onboarding: OnboardingRouteProps; addingWallet: boolean;
  sessionState: KhieProviderSessionState; pairing: boolean; approval?: ApprovalItem; queuedApprovalCount: number;
  localBackend?: LocalMnemonicSigningBackend; rpcUrls: NetworkRpcUrls; themePreference: ThemePreference;
  updateSettings: UpdateSettings; checkingForUpdates: boolean; currentVersion: string;
  buildCommit: string; appArchitecture: string; updateAvailable: boolean; updateAsset?: ReleaseAsset;
  biometricAvailable: boolean; biometricUnlock: boolean;
  masterPasswordSet: boolean; notice?: string; dialogs: ReactNode; onDismissNotice: () => void;
  onScreenChange: (screen: Screen) => void;
  onFinishOnboarding: (state: WalletState) => Promise<void> | void; onCancelAddingWallet: () => void;
  onPairKhie: (endpoint: string) => Promise<boolean>; onCancelKhiePairing: () => void;
  onConnectRelay: (address: string) => Promise<boolean>; onUnpairKhie: () => Promise<void>;
  onRespondToApproval: (approved: boolean) => void; onRefreshTrust: () => Promise<void>;
  onGenerateTrustKey: () => Promise<void>; onImportTrustKey: (privateKey: string) => Promise<void>;
  onResetTrustKey: () => Promise<void>; onChangeNetwork: (network: Network) => void;
  onChangeBiometricUnlock: (enabled: boolean) => Promise<void>;
  onChangeMasterPassword: (oldPassword: string, newPassword: string) => Promise<void>;
  onAddWallet: () => void; onRemoveWallet: (walletId: string) => Promise<void>;
  onSelectWallet: (walletId: string) => Promise<void>;
  onSaveRpcUrls: (urls: NetworkRpcUrls) => Promise<void>;
  onChangeThemePreference: (preference: ThemePreference) => Promise<void>;
  onChangeAutomaticUpdateChecks: (enabled: boolean) => Promise<void>;
  onCheckForUpdates: () => Promise<void> | void; onDownloadUpdate: () => Promise<void>;
}) {
  const theme = useTheme();
  const [scannedRecipient, setScannedRecipient] = useState<string>();
  const background = { backgroundColor: theme.colors.background };
  const baseNavigationTheme = theme.dark ? NavigationDarkTheme : NavigationLightTheme;
  const navigationTheme: NavigationTheme = {
    ...baseNavigationTheme,
    colors: {
      ...baseNavigationTheme.colors,
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.onSurface,
      border: theme.colors.outlineVariant,
      notification: theme.colors.error,
    },
  };
  const navigate = (next: Screen) => {
    if (!navigationRef.isReady()) return;
    if (navigationRef.getCurrentRoute()?.name === next) return;
    if (next === "receive" || next === "scanner" || next === "send") navigationRef.navigate(next);
    else navigationRef.navigate("tabs", { screen: next });
  };
  useEffect(() => { navigate(screen); }, [screen]);
  const updateScreen = () => {
    const route = navigationRef.getCurrentRoute()?.name;
    if (route && screenRoutes.has(route as Screen) && route !== screen) {
      onScreenChange(route as Screen);
    }
  };

  if (loading) return <LoadingScreen />;
  if (!profile || addingWallet) return <SafeAreaView style={[styles.safe, background]}>
    <StatusBar style={theme.dark ? "light" : "dark"} />
    {notice ? <Notice text={notice} onDismiss={onDismissNotice} /> : null}
    <OnboardingScreen {...onboarding} onComplete={onFinishOnboarding} onCancel={addingWallet ? onCancelAddingWallet : undefined} />
    {dialogs}
  </SafeAreaView>;

  const trust = profile.kind === "cryptape-trust" ? { id: profile.deviceId, name: profile.name, publicKey: profile.publicKey } : undefined;
  const initialTabRoute: TabRoute = screen === "khie" || screen === "trust" || screen === "settings" ? screen : "home";
  const tabBar = ({ state, navigation, insets }: BottomTabBarProps) =>
    <BottomBar current={state.routes[state.index]?.name as Screen} showTrust={Boolean(trust)} insets={insets} onNavigate={(next) => navigation.navigate(next as TabRoute)} />;
  return <SafeAreaView style={[styles.safe, background]} edges={["top", "right", "left"]}>
    <StatusBar style={theme.dark ? "light" : "dark"} />
    {notice ? <Notice text={notice} onDismiss={onDismissNotice} /> : null}
    <NavigationContainer theme={navigationTheme} ref={navigationRef} onReady={updateScreen} onStateChange={updateScreen}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="tabs">{() => <Tabs.Navigator initialRouteName={initialTabRoute} tabBar={tabBar} screenOptions={{ headerShown: false }}>
          <Tabs.Screen name="home">{({ navigation }) => <HomeScreen signer={signer} network={network} profile={profile} wallets={wallets} onSelectWallet={(id) => void onSelectWallet(id).catch(onboarding.onError)} onNavigate={(next) => next === "receive" || next === "send" ? navigation.getParent()?.navigate(next) : navigation.navigate(next as TabRoute)} />}</Tabs.Screen>
          <Tabs.Screen name="khie">{({ navigation }) => <KhieScreen state={sessionState} pairing={pairing} approval={approval} queuedApprovalCount={queuedApprovalCount} network={network} signer={signer} onScan={() => navigation.getParent()?.navigate("scanner")} onPair={onPairKhie} onCancelPairing={onCancelKhiePairing} onConnectRelay={onConnectRelay} onUnpair={onUnpairKhie} onRespond={onRespondToApproval} />}</Tabs.Screen>
          <Tabs.Screen name="trust">{() => trust ? <TrustDeviceScreen device={trust} onRefresh={onRefreshTrust} onGenerate={onGenerateTrustKey} onImport={onImportTrustKey} onReset={onResetTrustKey} /> : null}</Tabs.Screen>
          <Tabs.Screen name="settings">{() => <SettingsScreen key={profile.id} backend={localBackend} network={network} profile={profile} wallets={wallets} rpcUrls={rpcUrls} themePreference={themePreference} updateSettings={updateSettings} checkingForUpdates={checkingForUpdates} currentVersion={currentVersion} buildCommit={buildCommit} appArchitecture={appArchitecture} updateAvailable={updateAvailable} updateAsset={updateAsset} biometricAvailable={biometricAvailable} biometricUnlock={biometricUnlock} masterPasswordSet={masterPasswordSet} onChangeNetwork={onChangeNetwork} onChangeBiometricUnlock={onChangeBiometricUnlock} onChangeMasterPassword={onChangeMasterPassword} onSelectWallet={onSelectWallet} onAddWallet={onAddWallet} onRemoveWallet={onRemoveWallet} onSaveRpcUrls={onSaveRpcUrls} onChangeThemePreference={onChangeThemePreference} onChangeAutomaticUpdateChecks={onChangeAutomaticUpdateChecks} onCheckForUpdates={onCheckForUpdates} onDownloadUpdate={onDownloadUpdate} />}</Tabs.Screen>
        </Tabs.Navigator>}</Stack.Screen>
        <Stack.Screen name="receive">{({ navigation }) => <ReceiveScreen signer={signer} onBack={() => navigation.goBack()} />}</Stack.Screen>
        <Stack.Screen name="send">{({ navigation }) => <SendScreen signer={signer} onBack={() => navigation.goBack()} onScanAddress={() => navigation.navigate("sendScanner")} scannedAddress={scannedRecipient} onScannedAddressConsumed={() => setScannedRecipient(undefined)} />}</Stack.Screen>
        <Stack.Screen name="scanner">{({ navigation }) => <ScannerScreen onCancel={() => navigation.goBack()} onScanned={(value) => { navigation.goBack(); void onPairKhie(value); }} />}</Stack.Screen>
        <Stack.Screen name="sendScanner">{({ navigation }) => <ScannerScreen titleKey="scanWalletAddress" onCancel={() => navigation.goBack()} onScanned={(value) => { setScannedRecipient(value); navigation.goBack(); }} />}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
    {dialogs}
  </SafeAreaView>;
}
