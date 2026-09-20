import { ErrorTransactionInsufficientCapacity, fixedPointToString, type Signer, type Transaction } from "@ckb-ccc/core";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { ActivityIndicator, Button as PaperButton, Card as PaperCard, HelperText, Icon, IconButton, SegmentedButtons, Text, TextInput as PaperTextInput, useTheme } from "react-native-paper";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { CryptapeIcon } from "../components/CryptapeIcon";
import { InfoCard } from "../components/InfoCard";
import { RecommendedAppIcon } from "../components/RecommendedAppIcon";
import { useI18n } from "../i18n";
import type { Network, WalletProfile } from "../wallet/types";
import { prepareMaximumTransfer, prepareTransfer, selectedFeeRate, type TransferFeeOption, parseCkbAmount } from "../wallet/transfer";
import { TransactionApprovalDetails } from "../khie/TransactionApprovalDetails";
import { BackButton, FloatingLabelTextInput, QuietQrCode, errorMessage, useAppDialog } from "./components";
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
      setBalance(fixedPointToString(await signer.getBalance()));
    } catch {
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
    {profile.kind === "cryptape-trust" && signer ? <PaperButton mode="text" icon="tune-variant" style={styles.walletMenu} onPress={() => onNavigate("trust")}>{t("manageTrustDevice")}</PaperButton> : null}
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
      <View style={styles.homeActions}>
        <PaperButton icon="qrcode" mode="contained-tonal" style={styles.flexAction} onPress={() => onNavigate("receive")}>{t("receive")}</PaperButton>
        <PaperButton icon="send" mode="contained" style={styles.flexAction} onPress={() => onNavigate("send")}>{t("send")}</PaperButton>
      </View>
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
      <CopyableAddress address={address} centered />
    </PaperCard.Content></PaperCard>
  </ScrollView>;
}

function CopyableAddress({ address, centered = false }: { address: string; centered?: boolean }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [address]);
  const copy = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setCopied(true);
  };
  return <Pressable accessibilityRole="button" accessibilityLabel={copied ? t("walletAddressCopied") : t("copyWalletAddress")} accessibilityLiveRegion="polite" onPress={() => void copy()} style={({ pressed }) => [styles.addressCopyRow, centered && styles.addressCopyRowCentered, pressed && styles.endpointCopyRowPressed]}><Text variant="bodyMedium" selectable numberOfLines={centered ? 3 : 1} ellipsizeMode="middle" style={[styles.mono, styles.addressCopyText, centered && styles.centerText]}>{address}</Text><Icon source={copied ? "check" : "content-copy"} size={18} color={theme.colors.onSurfaceVariant} /></Pressable>;
}

export function SendScreen({ signer, onBack, onScanAddress, scannedAddress, onScannedAddressConsumed }: { signer?: Signer; onBack: () => void; onScanAddress: () => void; scannedAddress?: string; onScannedAddressConsumed: () => void }) {
  const { t } = useI18n();
  const appDialog = useAppDialog();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [feeOption, setFeeOption] = useState<TransferFeeOption>("auto");
  const [customFee, setCustomFee] = useState("");
  const [prepared, setPrepared] = useState<{
    feeRate?: bigint;
    revision: number;
    signer: Signer;
    transaction: Transaction;
  }>();
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const draftRevision = useRef(0);
  const signerRef = useRef(signer);
  signerRef.current = signer;
  const parsedAmount = parseCkbAmount(amount);
  const feeRate = selectedFeeRate(feeOption, customFee);
  const customFeeValid = feeOption !== "custom" || feeRate !== undefined;

  const invalidateDraft = useCallback(() => {
    draftRevision.current += 1;
    setPrepared(undefined);
  }, []);

  useEffect(() => invalidateDraft(), [invalidateDraft, signer]);

  useEffect(() => {
    if (!scannedAddress) return;
    setRecipient(scannedAddress);
    invalidateDraft();
    onScannedAddressConsumed();
  }, [invalidateDraft, onScannedAddressConsumed, scannedAddress]);

  const reportPreparationError = (cause: unknown) => {
    const description = cause instanceof ErrorTransactionInsufficientCapacity
      ? t("insufficientCapacity")
      : errorMessage(cause, t);
    appDialog.show(t("unableToPrepareTransaction"), description);
  };
  const prepare = async () => {
    if (!signer) return;
    if (!recipient.trim()) { appDialog.show(t("unableToPrepareTransaction"), t("invalidRecipientAddress")); return; }
    if (!parsedAmount) { appDialog.show(t("unableToPrepareTransaction"), t("invalidSendAmount")); return; }
    if (!customFeeValid) { appDialog.show(t("unableToPrepareTransaction"), t("invalidFeeRate")); return; }
    const revision = draftRevision.current;
    const requestSigner = signer;
    const requestRecipient = recipient;
    const requestAmount = parsedAmount;
    const requestFeeRate = feeRate;
    setPreparing(true);
    try {
      const transaction = await prepareTransfer(
        requestSigner,
        requestRecipient,
        requestAmount,
        requestFeeRate,
      );
      if (
        draftRevision.current === revision &&
        signerRef.current === requestSigner
      ) {
        setPrepared({
          feeRate: requestFeeRate,
          revision,
          signer: requestSigner,
          transaction,
        });
      }
    } catch (cause) {
      if (draftRevision.current === revision && signerRef.current === requestSigner) {
        reportPreparationError(cause);
      }
    } finally { setPreparing(false); }
  };
  const useMaximum = async () => {
    if (!signer) return;
    if (!recipient.trim()) { appDialog.show(t("unableToPrepareTransaction"), t("invalidRecipientAddress")); return; }
    if (!customFeeValid) { appDialog.show(t("unableToPrepareTransaction"), t("invalidFeeRate")); return; }
    const revision = draftRevision.current;
    const requestSigner = signer;
    const requestRecipient = recipient;
    const requestFeeRate = feeRate;
    setPreparing(true);
    try {
      const resolvedFeeRate = requestFeeRate ?? await requestSigner.client.getFeeRate();
      const maximum = await prepareMaximumTransfer(
        requestSigner,
        requestRecipient,
        resolvedFeeRate,
      );
      if (
        draftRevision.current === revision &&
        signerRef.current === requestSigner
      ) {
        draftRevision.current += 1;
        setAmount(fixedPointToString(maximum));
        setPrepared(undefined);
      }
    } catch (cause) {
      if (draftRevision.current === revision && signerRef.current === requestSigner) {
        reportPreparationError(cause);
      }
    } finally { setPreparing(false); }
  };
  const send = async () => {
    if (!signer || !prepared) return;
    if (
      signer !== prepared.signer ||
      draftRevision.current !== prepared.revision
    ) {
      invalidateDraft();
      appDialog.show(t("transactionSendFailed"), t("transferDraftChanged"));
      return;
    }
    setSending(true);
    try {
      const hash = await prepared.signer.sendTransaction(prepared.transaction);
      setPrepared(undefined);
      appDialog.show(t("transactionSent"), hash);
      onBack();
    } catch (cause) {
      appDialog.show(t("transactionSendFailed"), errorMessage(cause, t));
    } finally { setSending(false); }
  };

  if (prepared && signer === prepared.signer && draftRevision.current === prepared.revision) return <ScrollView contentContainerStyle={styles.page}>
    <BackButton onPress={() => setPrepared(undefined)} />
    <Text variant="headlineMedium">{t("reviewTransaction")}</Text>
    <TransactionApprovalDetails client={prepared.signer.client} transaction={prepared.transaction} signer={prepared.signer} requestedFeeRate={feeOption === "auto" ? undefined : prepared.feeRate} />
    <View style={styles.approvalActions}><PaperButton mode="outlined" style={styles.flexAction} onPress={() => setPrepared(undefined)}>{t("back")}</PaperButton><PaperButton mode="contained" style={styles.flexAction} icon="send" loading={sending} disabled={sending} onPress={() => void send()}>{t("send")}</PaperButton></View>
  </ScrollView>;

  return <KeyboardAwareScrollView bottomOffset={16} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <BackButton onPress={onBack} />
    <Text variant="headlineMedium">{t("sendCkb")}</Text>
    <FloatingLabelTextInput label={t("recipientAddress")} placeholder={t("recipientAddressPlaceholder")} autoCapitalize="none" autoCorrect={false} multiline numberOfLines={3} textAlignVertical="top" style={styles.recipientAddressInput} value={recipient} onChangeText={(value) => { setRecipient(value); invalidateDraft(); }} right={<PaperTextInput.Icon icon="qrcode-scan" accessibilityLabel={t("scanWalletAddress")} onPress={onScanAddress} />} />
    <View style={styles.amountRow}><View style={styles.amountInput}><FloatingLabelTextInput label={t("amount")} keyboardType="decimal-pad" value={amount} onChangeText={(value) => { setAmount(value.replace(/[^0-9.]/g, "")); invalidateDraft(); }} /></View><PaperButton mode="contained-tonal" loading={preparing} disabled={preparing || !signer} onPress={() => void useMaximum()}>{t("max")}</PaperButton></View>
    {amount.length > 0 && !parsedAmount ? <HelperText type="error" visible>{t("invalidSendAmount")}</HelperText> : null}
    <Text variant="titleMedium">{t("fee")}</Text>
    <SegmentedButtons value={feeOption} onValueChange={(value) => { setFeeOption(value as TransferFeeOption); invalidateDraft(); }} buttons={[{ value: "economy", label: t("feeEconomy"), showSelectedCheck: false }, { value: "auto", label: t("feeAuto"), showSelectedCheck: false }, { value: "custom", label: t("feeCustom"), showSelectedCheck: false }]} />
    <Text variant="bodySmall">{feeOption === "economy" ? t("feeEconomyDescription") : feeOption === "auto" ? t("feeAutoDescription") : t("feeCustomDescription")}</Text>
    {feeOption === "custom" ? <><FloatingLabelTextInput label={t("customFeeRate")} placeholder={t("shannonsPerKb", { rate: "" })} keyboardType="number-pad" value={customFee} onChangeText={(value) => { setCustomFee(value.replace(/\D/g, "")); invalidateDraft(); }} />{!customFeeValid ? <HelperText type="error">{t("invalidFeeRate")}</HelperText> : null}</> : null}
    <PaperButton mode="contained" icon="file-search-outline" loading={preparing} disabled={preparing || !signer || !parsedAmount || !customFeeValid} onPress={() => void prepare()}>{t("reviewTransaction")}</PaperButton>
  </KeyboardAwareScrollView>;
}
