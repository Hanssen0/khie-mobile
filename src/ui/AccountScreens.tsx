import { fixedPointToString, type Signer } from "@ckb-ccc/core";
import { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, useWindowDimensions, View } from "react-native";
import { ActivityIndicator, Button as PaperButton, Card as PaperCard, Icon, IconButton, Text, useTheme } from "react-native-paper";

import { CryptapeIcon } from "../components/CryptapeIcon";
import { InfoCard } from "../components/InfoCard";
import { RecommendedAppIcon } from "../components/RecommendedAppIcon";
import { useI18n } from "../i18n";
import type { Network, WalletProfile } from "../wallet/types";
import { BackButton, QuietQrCode } from "./components";
import { WalletMenu, walletLabel } from "./navigation";
import { styles } from "./styles";
import type { Screen } from "./types";

export function HomeScreen({ signer, network, profile, wallets, onSelectWallet, onNavigate }: {
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
  const integerFontSize = Math.max(28, Math.min(45, (width - 136) / Math.max(integerBalance.length * 0.58, 1)));
  const refresh = useCallback(async () => {
    if (!signer) return;
    setRefreshing(true);
    try {
      const [nextAddress, nextBalance] = await Promise.all([signer.getRecommendedAddress(), signer.getBalance()]);
      setAddress(nextAddress);
      setBalance(fixedPointToString(nextBalance));
    } catch {
      try { setAddress(await signer.getRecommendedAddress()); } catch { setAddress(t("addressReadFailed")); }
      setBalance(t("readFailed"));
    } finally { setRefreshing(false); }
  }, [signer, t]);
  useEffect(() => void refresh(), [refresh, network]);
  const recommendedApps = [
    { name: "NervDAO", description: t("nervDaoDescription"), icon: "nervdao", url: "https://nervdao.com/" },
    { name: "Omiga", description: t("omigaDescription"), icon: "omiga", url: "https://omiga.io/" },
    { name: "CCC App", description: t("cccAppDescription"), icon: "ccc", url: "https://app.ckbccc.com/" },
  ] as const;
  return <ScrollView contentContainerStyle={styles.page}>
    <WalletMenu wallets={wallets} selected={profile.id} onSelect={onSelectWallet} />
    {profile.kind === "cryptape-trust" && !signer ? <PaperCard mode="elevated">
      <PaperCard.Title title="Cryptape Trust" subtitle={walletLabel(wallets, profile.id, t)} left={({ size }) => <CryptapeIcon color={theme.colors.onSurfaceVariant} size={size} />} />
      <PaperCard.Content><Text variant="bodyMedium">{t("trustDeviceHasNoKey")}</Text></PaperCard.Content>
      <PaperCard.Actions style={styles.cardActions}><PaperButton mode="contained" icon="tune-variant" onPress={() => onNavigate("trust")}>{t("manageTrustDevice")}</PaperButton></PaperCard.Actions>
    </PaperCard> : <>
      <View style={styles.balanceBlock}>
        <Text variant="labelLarge">{network === "testnet" ? t("ckbTestnet") : t("ckbMainnet")}</Text>
        <View style={styles.balanceValue}><View style={styles.balanceIntegerRow}>
          <View style={styles.balanceActionSpacer} />
          <View style={styles.balanceNumber}>
            <Text variant="displayMedium" numberOfLines={1} style={[styles.balanceInteger, { fontSize: integerFontSize, lineHeight: Math.round(integerFontSize * 1.16) }]}>{integerBalance}</Text>
            {fractionalBalance ? <Text variant="titleLarge" style={[styles.balanceFraction, { color: theme.colors.onSurfaceVariant }]}>{fractionalBalance}</Text> : null}
          </View>
          <IconButton icon="refresh" loading={refreshing} disabled={refreshing} accessibilityLabel={t("refresh")} style={styles.balanceRefresh} onPress={() => void refresh()} />
        </View></View>
        <Text variant="titleMedium">CKB</Text>
      </View>
      <PaperCard mode="elevated">
        <PaperCard.Title title={t("walletAddress")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="identifier" />} />
        <PaperCard.Content><Text variant="bodyMedium" selectable style={styles.mono}>{address}</Text></PaperCard.Content>
        <PaperCard.Actions style={styles.cardActions}><PaperButton icon="qrcode" mode="contained" onPress={() => onNavigate("receive")}>{t("receive")}</PaperButton></PaperCard.Actions>
      </PaperCard>
    </>}
    <View style={styles.recommendedSection}>
      <Text variant="titleLarge">{t("recommendedApps")}</Text>
      <View style={styles.recommendedApps}>{recommendedApps.map((app) => <InfoCard key={app.url} title={app.name} description={app.description} centerContent icon={({ color, size }) => <RecommendedAppIcon name={app.icon} size={size} color={color} />} showExternalLink onPress={() => void Linking.openURL(app.url).catch(() => undefined)} />)}</View>
    </View>
  </ScrollView>;
}

export function ReceiveScreen({ signer, onBack }: { signer?: Signer; onBack: () => void }) {
  const { t } = useI18n();
  const [address, setAddress] = useState("");
  useEffect(() => { void signer?.getRecommendedAddress().then(setAddress); }, [signer]);
  return <ScrollView contentContainerStyle={styles.page}>
    <BackButton onPress={onBack} />
    <Text variant="headlineMedium">{t("receive")}</Text>
    <PaperCard mode="elevated"><PaperCard.Content style={styles.qrContent}>
      {address ? <QuietQrCode value={address} size={230} /> : <ActivityIndicator />}
      <Text variant="bodyMedium" selectable style={[styles.mono, styles.centerText]}>{address}</Text>
    </PaperCard.Content></PaperCard>
  </ScrollView>;
}
