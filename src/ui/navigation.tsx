import { useState } from "react";
import { View } from "react-native";
import { BottomNavigation, Button as PaperButton, Divider, Menu, SegmentedButtons } from "react-native-paper";
import type { EdgeInsets } from "react-native-safe-area-context";

import { cryptapeIconSource, cryptapeOutlinedIconSource } from "../components/CryptapeIcon";
import { khieFilledIconSource, khieIconSource } from "../components/KhieIcon";
import { languageLabel, languageOptions, useI18n, type Translate } from "../i18n";
import { normalizeTrustPublicKey } from "../wallet/trustSignature";
import type { Network, WalletProfile } from "../wallet/types";
import { styles } from "./styles";
import type { Screen } from "./types";

const material3BottomBarHeight = 80;

export function NetworkSwitch({ value, onChange }: { value: Network; onChange: (network: Network) => void }) {
  const { t } = useI18n();
  return <SegmentedButtons density="small" value={value} onValueChange={(next) => onChange(next as Network)} buttons={[
    { value: "testnet", label: t("testnet"), showSelectedCheck: false },
    { value: "mainnet", label: t("mainnet"), showSelectedCheck: false },
  ]} style={styles.networkSwitch} />;
}

export function WalletMenu({ wallets, selected, onSelect }: { wallets: WalletProfile[]; selected?: string; onSelect: (walletId: string) => void }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <Menu visible={visible} onDismiss={() => setVisible(false)} anchor={
      <PaperButton mode="contained-tonal" icon="wallet" onPress={() => setVisible(true)} style={styles.walletMenu}>
        {walletLabel(wallets, selected ?? "", t)}
      </PaperButton>
    }>
      {wallets.map((wallet) => <Menu.Item key={wallet.id} leadingIcon={wallet.id === selected ? "check" : "wallet-outline"} title={walletLabel(wallets, wallet.id, t)} onPress={() => {
        setVisible(false);
        if (wallet.id !== selected) onSelect(wallet.id);
      }} />)}
    </Menu>
  );
}

export function BottomBar({ current, showTrust, insets, onNavigate }: { current: Screen; showTrust: boolean; insets: EdgeInsets; onNavigate: (screen: Screen) => void }) {
  const { t } = useI18n();
  const routes = [
    { key: "home", title: t("account"), focusedIcon: "wallet", unfocusedIcon: "wallet-outline" },
    { key: "khie", title: "Khie", focusedIcon: khieFilledIconSource, unfocusedIcon: khieIconSource },
    ...(showTrust ? [{ key: "trust", title: "Cryptape Trust", focusedIcon: cryptapeIconSource, unfocusedIcon: cryptapeOutlinedIconSource }] : []),
    { key: "settings", title: t("settings"), focusedIcon: "cog", unfocusedIcon: "cog-outline" },
  ];
  const selected = current === "receive" ? "home" : current;
  const index = Math.max(0, routes.findIndex(({ key }) => key === selected));
  const containerStyle = { height: material3BottomBarHeight + insets.bottom, flexShrink: 0 };
  return <View style={containerStyle}>
    <BottomNavigation.Bar compact shifting={false} safeAreaInsets={insets} navigationState={{ index, routes }} onTabPress={({ route }) => onNavigate(route.key as Screen)} />
  </View>;
}

export function LanguageMenu() {
  const { preference, setPreference, t } = useI18n();
  const [visible, setVisible] = useState(false);
  const choose = (next: Parameters<typeof setPreference>[0]) => { setVisible(false); setPreference(next); };
  return (
    <Menu visible={visible} onDismiss={() => setVisible(false)} anchor={<PaperButton mode="contained-tonal" icon="translate" onPress={() => setVisible(true)}>{languageLabel(preference, t)}</PaperButton>}>
      <Menu.Item leadingIcon={preference === "system" ? "check" : "cellphone-cog"} title={t("followSystem")} onPress={() => choose("system")} />
      <Divider />
      {languageOptions.map((option) => <Menu.Item key={option.value} leadingIcon={preference === option.value ? "check" : undefined} title={option.label} onPress={() => choose(option.value)} />)}
    </Menu>
  );
}

export function walletLabel(wallets: WalletProfile[], walletId: string, t: Translate): string {
  const wallet = wallets.find((item) => item.id === walletId);
  if (wallet?.kind === "cryptape-trust") return `Cryptape Trust · ${wallet.deviceId.slice(-5)}`;
  const index = wallets.findIndex((item) => item.id === walletId);
  return t("walletNumber", { number: Math.max(0, index) + 1 });
}

export function hasTrustPublicKeyChanged(cached?: string, connected?: string): boolean {
  if (!cached || !connected) return Boolean(cached) !== Boolean(connected);
  return normalizeTrustPublicKey(cached) !== normalizeTrustPublicKey(connected);
}
