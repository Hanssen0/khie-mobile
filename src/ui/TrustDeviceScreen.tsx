import { useState } from "react";
import { ImageBackground, ScrollView, useWindowDimensions, View } from "react-native";
import { Button as PaperButton, Card as PaperCard, Dialog, Divider, Icon, List, Portal, Text, useTheme } from "react-native-paper";
import { KeyboardAvoidingView, KeyboardController } from "react-native-keyboard-controller";

import { CryptapeIcon } from "../components/CryptapeIcon";
import { useI18n } from "../i18n";
import { type ConnectedTrustDevice, isTrustSupported, scanForTrustDevices, type TrustDevice } from "../trust/native";
import { errorMessage, KeyboardDialogContent, useAppDialog, useTrustBluetoothSetup, WalletTextInput } from "./components";
import { styles } from "./styles";

export function TrustWalletPicker({ onConnect }: { onConnect: (device: TrustDevice) => Promise<void> }) {
  const { t } = useI18n(); const appDialog = useAppDialog(); const { show: showTrustBluetoothSetupError } = useTrustBluetoothSetup();
  const [devices, setDevices] = useState<TrustDevice[]>([]); const [scanning, setScanning] = useState(false); const [connectingId, setConnectingId] = useState<string>();
  const supported = isTrustSupported(); const compactDeviceLayout = useWindowDimensions().width < 400;
  const scan = async () => { setScanning(true); setDevices([]); try { setDevices(await scanForTrustDevices()); } catch (cause) { if (!showTrustBluetoothSetupError(cause)) appDialog.show(t("trustWalletConnectionFailed"), errorMessage(cause, t)); } finally { setScanning(false); } };
  const connect = async (device: TrustDevice) => { setConnectingId(device.id); try { await onConnect(device); setDevices([]); } catch (cause) { appDialog.show(t("trustWalletConnectionFailed"), errorMessage(cause, t)); } finally { setConnectingId(undefined); } };
  return <View style={styles.trustPicker}>
    {!supported ? <Text variant="bodyMedium">{t("trustWalletAndroidBuildOnly")}</Text> : null}
    {devices.map((device) => <View key={device.id} style={styles.trustDeviceResult}><List.Item title={device.name} description={device.id} left={(props) => <List.Icon {...props} icon="memory" />} right={compactDeviceLayout ? undefined : (props) => <PaperButton mode="contained-tonal" style={props.style} contentStyle={styles.extraHorizontalButtonPadding} loading={connectingId === device.id} disabled={Boolean(connectingId)} onPress={() => void connect(device)}>{t("connect")}</PaperButton>} />{compactDeviceLayout ? <PaperButton mode="contained-tonal" style={styles.trustDeviceConnectCompact} contentStyle={styles.extraHorizontalButtonPadding} loading={connectingId === device.id} disabled={Boolean(connectingId)} onPress={() => void connect(device)}>{t("connect")}</PaperButton> : null}</View>)}
    <View style={styles.trustPickerActions}><PaperButton mode="contained" icon="bluetooth" loading={scanning} disabled={!supported || scanning || Boolean(connectingId)} onPress={() => void scan()}>{t("scanTrustWallets")}</PaperButton></View>
  </View>;
}

export function TrustWalletBanner() {
  const { t } = useI18n(); const theme = useTheme();
  return <ImageBackground accessibilityLabel={t("trustWallet")} imageStyle={styles.trustBannerImage} resizeMode="cover" source={require("../../assets/cryptape-trust-device-banner.jpg")} style={styles.trustBanner}><View style={[styles.trustBannerTint, { backgroundColor: theme.dark ? "rgba(0, 35, 33, 0.30)" : "rgba(0, 96, 84, 0.12)" }]} /></ImageBackground>;
}

type TrustKeyAction = "generate" | "import" | "reset";

export function TrustDeviceScreen({ device, onRefresh, onGenerate, onImport, onReset }: { device: ConnectedTrustDevice; onRefresh: () => Promise<void>; onGenerate: () => Promise<void>; onImport: (privateKey: string) => Promise<void>; onReset: () => Promise<void> }) {
  const { t } = useI18n(); const appDialog = useAppDialog(); const { show: showTrustBluetoothSetupError } = useTrustBluetoothSetup(); const theme = useTheme();
  const [action, setAction] = useState<TrustKeyAction>(); const [privateKey, setPrivateKey] = useState(""); const [busy, setBusy] = useState(false); const [refreshingDevice, setRefreshingDevice] = useState(false);
  const privateKeyValid = /^[0-9a-fA-F]{64}$/.test(privateKey);
  const closeAction = () => { if (busy) return; void KeyboardController.dismiss({ animated: false }); setAction(undefined); setPrivateKey(""); };
  const runAction = async () => {
    const selectedAction = action;
    if (!selectedAction) return;
    const importedPrivateKey = privateKey;
    await KeyboardController.dismiss({ animated: false });
    setAction(undefined); setPrivateKey(""); setBusy(true);
    try {
      if (selectedAction === "generate") await onGenerate();
      if (selectedAction === "import") await onImport(importedPrivateKey);
      if (selectedAction === "reset") await onReset();
    } catch (cause) {
      if (cause instanceof Error && cause.message === "Cryptape Trust key operation was cancelled") return;
      if (!showTrustBluetoothSetupError(cause)) appDialog.show(t("trustKeyOperationFailed"), errorMessage(cause, t));
    } finally { setBusy(false); }
  };
  return <>
    <ScrollView contentContainerStyle={[styles.page, styles.settingsPage]}>
      <Text variant="headlineMedium">{t("trustDevice")}</Text>
      <PaperCard mode="elevated"><PaperCard.Title title={device.name} leftStyle={styles.cardTitleLeft} left={({ size }) => <CryptapeIcon color={theme.colors.onSurfaceVariant} size={size} />} /><PaperCard.Content style={styles.cardContent}><View style={styles.metadataBlock}><Text variant="labelMedium">{t("deviceAddress")}</Text><Text variant="bodyMedium" selectable style={styles.mono}>{device.id}</Text></View><Divider /><View style={styles.metadataBlock}><Text variant="labelMedium">{t("publicKey")}</Text>{device.publicKey ? <Text variant="bodySmall" selectable style={styles.mono}>{device.publicKey}</Text> : <Text variant="bodyMedium">{t("trustDeviceHasNoKey")}</Text>}</View></PaperCard.Content><PaperCard.Actions style={styles.cardActions}><PaperButton mode="contained-tonal" icon="refresh" loading={refreshingDevice} disabled={refreshingDevice} onPress={() => { setRefreshingDevice(true); void onRefresh().catch((cause: unknown) => { if (!showTrustBluetoothSetupError(cause)) appDialog.show(t("trustWalletConnectionFailed"), errorMessage(cause, t)); }).finally(() => setRefreshingDevice(false)); }}>{t("refresh")}</PaperButton></PaperCard.Actions></PaperCard>
      <PaperCard mode="elevated"><PaperCard.Title title={t("trustKeyManagement")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="key-chain-variant" />} /><PaperCard.Content style={styles.cardContent}><Text variant="bodyMedium">{device.publicKey ? t("trustKeyPresentDescription") : t("trustKeyMissingDescription")}</Text></PaperCard.Content><PaperCard.Actions style={styles.cardActions}>{device.publicKey ? <PaperButton mode="text" icon="key-remove" textColor={theme.colors.error} onPress={() => setAction("reset")}>{t("resetTrustKey")}</PaperButton> : null}{!device.publicKey ? <PaperButton mode="text" icon="key-plus" onPress={() => setAction("import")}>{t("importTrustKey")}</PaperButton> : null}{!device.publicKey ? <PaperButton mode="contained" icon="key-plus" onPress={() => setAction("generate")}>{t("generateTrustKey")}</PaperButton> : null}</PaperCard.Actions></PaperCard>
    </ScrollView>
    {action ? <TrustKeyDialog action={action} busy={busy} privateKey={privateKey} privateKeyValid={privateKeyValid} onDismiss={closeAction} onPrivateKeyChange={setPrivateKey} onSubmit={runAction} /> : null}
  </>;
}

function TrustKeyDialog({ action, busy, privateKey, privateKeyValid, onDismiss, onPrivateKeyChange, onSubmit }: { action: TrustKeyAction; busy: boolean; privateKey: string; privateKeyValid: boolean; onDismiss: () => void; onPrivateKeyChange: (value: string) => void; onSubmit: () => Promise<void> }) {
  const { t } = useI18n(); const theme = useTheme();
  const actionTitle = action === "generate" ? t("generateTrustKey") : action === "import" ? t("importTrustKey") : t("resetTrustKey");
  const actionDescription = action === "generate" ? t("generateTrustKeyDescription") : action === "import" ? t("importTrustKeyDescription") : t("resetTrustKeyDescription");
  return <Portal><KeyboardAvoidingView behavior="height" pointerEvents="box-none" style={styles.keyboardDialogLayer}><Dialog visible dismissable={!busy} onDismiss={onDismiss} style={styles.keyboardDialog}><Dialog.Title>{actionTitle}</Dialog.Title><KeyboardDialogContent><Text variant="bodyMedium">{actionDescription}</Text>{action === "import" ? <WalletTextInput autoFocus autoCapitalize="none" autoCorrect={false} label={t("trustPrivateKey")} maxLength={64} secureTextEntry value={privateKey} onChangeText={(value) => onPrivateKeyChange(value.replace(/[^0-9a-f]/gi, ""))} /> : null}</KeyboardDialogContent><Dialog.Actions style={styles.dialogActions}><PaperButton contentStyle={styles.extraHorizontalButtonPadding} disabled={busy} onPress={onDismiss}>{t("cancel")}</PaperButton><PaperButton mode="contained" contentStyle={styles.extraHorizontalButtonPadding} buttonColor={action === "reset" ? theme.colors.error : undefined} loading={busy} disabled={busy || (action === "import" && !privateKeyValid)} onPress={() => void onSubmit()}>{action === "reset" ? t("resetTrustKey") : t("continue")}</PaperButton></Dialog.Actions></Dialog></KeyboardAvoidingView></Portal>;
}
