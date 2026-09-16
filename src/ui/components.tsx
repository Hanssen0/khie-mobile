import { type SignerJsonRpcConfirmation } from "@ckb-ccc/core";
import QRCode from "react-native-qrcode-svg";
import { useCallback, useContext, useMemo, useState, createContext } from "react";
import { Linking, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Button as PaperButton,
  Dialog,
  PaperProvider,
  Portal,
  Snackbar,
  Text,
  TextInput as PaperTextInput,
  useTheme,
} from "react-native-paper";

import { LocalizedError } from "../errors";
import { useI18n, type Translate } from "../i18n";
import { type KhieProviderSessionError } from "../khie/KhieProviderSession";
import { TrustBluetoothSetupError } from "../trust/native";
import { type WalletAuthenticationPurpose } from "../storage/walletVault";
import { styles } from "./styles";

type TrustBluetoothSetupContextValue = { show: (cause: unknown) => boolean };
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

const TrustBluetoothSetupContext = createContext<TrustBluetoothSetupContextValue | undefined>(undefined);
const AppDialogContext = createContext<AppDialogContextValue | undefined>(undefined);

export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <PaperButton mode="contained" disabled={disabled} onPress={onPress}>{label}</PaperButton>;
}

export function SecondaryButton({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const theme = useTheme();
  return (
    <PaperButton mode="outlined" disabled={disabled} onPress={onPress} textColor={danger ? theme.colors.error : undefined}>
      {label}
    </PaperButton>
  );
}

export function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <PaperButton compact mode="text" labelStyle={styles.linkButtonLabel} onPress={onPress}>{label}</PaperButton>;
}

export function WalletTextInput(props: React.ComponentProps<typeof PaperTextInput>) {
  return <PaperTextInput mode="outlined" {...props} />;
}

export function KeyboardDialogContent({ children }: { children: React.ReactNode }) {
  return (
    <Dialog.Content style={styles.keyboardDialogContent}>
      <ScrollView bounces={false} contentContainerStyle={styles.cardContent} keyboardShouldPersistTaps="handled" overScrollMode="never" showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </Dialog.Content>
  );
}

export function FloatingLabelTextInput({ label, accessibilityLabel, onBlur, onFocus, style, ...props }: React.ComponentProps<typeof PaperTextInput> & { label: string }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.floatingInputContainer}>
      <WalletTextInput
        {...props}
        accessibilityLabel={accessibilityLabel ?? label}
        style={[styles.khieInput, style]}
        onFocus={(event) => { setFocused(true); onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      />
      <View pointerEvents="none" style={[styles.floatingInputLabel, { backgroundColor: theme.colors.background }]}>
        <Text variant="bodySmall" style={{ color: focused ? theme.colors.primary : theme.colors.onSurfaceVariant }}>{label}</Text>
      </View>
    </View>
  );
}

export function QuietQrCode({ value, size }: { value: string; size: number }) {
  return <View style={styles.qrFrame}><QRCode value={value} size={size} color="black" backgroundColor="white" quietZone={12} /></View>;
}

export function BackButton({ onPress }: { onPress: () => void }) {
  const { t } = useI18n();
  return <PaperButton compact icon="arrow-left" onPress={onPress} style={styles.backButton}>{t("back")}</PaperButton>;
}

export function Notice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const { t } = useI18n();
  return <Portal><Snackbar visible onDismiss={onDismiss} action={{ label: t("close"), onPress: onDismiss }} wrapperStyle={styles.snackbar}>{text}</Snackbar></Portal>;
}

export function LoadingScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  return <SafeAreaView style={[styles.safe, styles.center, { backgroundColor: theme.colors.background }]}><ActivityIndicator size="large" /><Text variant="bodyLarge">{t("loadingWallet")}</Text></SafeAreaView>;
}

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [dialog, setDialog] = useState<AppDialogState>();
  const show = useCallback((title: string, message: string) => setDialog({ title, message }), []);
  const confirm = useCallback((next: AppDialogState) => setDialog(next), []);
  const value = useMemo(() => ({ show, confirm }), [confirm, show]);
  const dismiss = () => setDialog(undefined);
  const accept = () => { const onConfirm = dialog?.onConfirm; setDialog(undefined); onConfirm?.(); };
  return (
    <AppDialogContext.Provider value={value}>
      {children}
      <Portal><Dialog visible={Boolean(dialog)} onDismiss={dismiss}>
        <Dialog.Title>{dialog?.title}</Dialog.Title>
        <Dialog.Content><Text variant="bodyMedium">{dialog?.message}</Text></Dialog.Content>
        <Dialog.Actions style={styles.dialogActions}>
          {dialog?.cancelLabel ? <PaperButton contentStyle={styles.extraHorizontalButtonPadding} onPress={dismiss}>{dialog.cancelLabel}</PaperButton> : null}
          <PaperButton mode="contained" buttonColor={dialog?.destructive ? theme.colors.error : undefined} contentStyle={styles.extraHorizontalButtonPadding} onPress={accept}>{dialog?.confirmLabel ?? t("close")}</PaperButton>
        </Dialog.Actions>
      </Dialog></Portal>
    </AppDialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogContextValue {
  const context = useContext(AppDialogContext);
  if (!context) throw new Error("AppDialogProvider is missing");
  return context;
}

export function errorMessage(cause: unknown, t: Translate): string {
  if (!(cause instanceof Error)) return t("operationFailed");
  if (cause instanceof LocalizedError) return t(cause.translationKey, cause.translationValues);
  const exactErrors: Partial<Record<string, Parameters<Translate>[0]>> = {
    "Invalid password": "invalidWalletPassword",
    "Bluetooth permission is required to find Cryptape Trust devices": "trustBluetoothPermissionRequired",
    "Bluetooth is not available": "trustBluetoothUnavailable",
    "Bluetooth is not available on this device": "trustBluetoothUnavailable",
    "Turn on Bluetooth to find Cryptape Trust devices": "trustBluetoothDisabled",
    "Cryptape Trust signing was cancelled": "trustSigningCancelled",
    "Cryptape Trust PIN must contain 8 digits": "trustPinInvalid",
    "Cryptape Trust public key has changed": "trustPublicKeyChanged",
    "Trust hardware wallets are only available in an Android development build": "trustWalletAndroidBuildOnly",
  };
  return exactErrors[cause.message] ? t(exactErrors[cause.message]!) : cause.message;
}

export function TrustBluetoothSetupProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [error, setError] = useState<TrustBluetoothSetupError>();
  const show = useCallback((cause: unknown) => {
    if (!(cause instanceof TrustBluetoothSetupError)) return false;
    setError(cause);
    return true;
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  const details = error
    ? error.issue === "permissionDenied" ? { title: t("trustBluetoothPermissionTitle"), message: t("trustBluetoothPermissionRequired") }
      : error.issue === "bluetoothDisabled" ? { title: t("trustBluetoothDisabledTitle"), message: t("trustBluetoothDisabled") }
        : error.issue === "locationDisabled" ? { title: t("trustLocationDisabledTitle"), message: t("trustLocationDisabled") }
          : { title: t("trustBluetoothUnavailableTitle"), message: t("trustBluetoothUnavailable") }
    : undefined;
  const openSettings = () => {
    if (!error) return;
    const action = error.settings === "bluetooth" ? "android.settings.BLUETOOTH_SETTINGS" : error.settings === "location" ? "android.settings.LOCATION_SOURCE_SETTINGS" : undefined;
    setError(undefined);
    const open = action ? Linking.sendIntent(action).catch(() => Linking.openSettings()) : Linking.openSettings();
    void open.catch(() => undefined);
  };
  return (
    <TrustBluetoothSetupContext.Provider value={value}>
      {children}
      <Portal><Dialog visible={Boolean(error)} onDismiss={() => setError(undefined)}>
        <Dialog.Icon icon="bluetooth" />
        <Dialog.Title style={styles.centerText}>{details?.title}</Dialog.Title>
        <Dialog.Content><Text variant="bodyMedium">{details?.message}</Text></Dialog.Content>
        <Dialog.Actions style={styles.dialogActions}>
          <PaperButton mode={error?.issue === "bluetoothUnavailable" ? "contained" : "text"} contentStyle={styles.extraHorizontalButtonPadding} onPress={() => setError(undefined)}>{error?.issue === "bluetoothUnavailable" ? t("close") : t("cancel")}</PaperButton>
          {error?.issue !== "bluetoothUnavailable" ? <PaperButton mode="contained" contentStyle={styles.extraHorizontalButtonPadding} onPress={openSettings}>{t("openSettings")}</PaperButton> : null}
        </Dialog.Actions>
      </Dialog></Portal>
    </TrustBluetoothSetupContext.Provider>
  );
}

export function useTrustBluetoothSetup(): TrustBluetoothSetupContextValue {
  const context = useContext(TrustBluetoothSetupContext);
  if (!context) throw new Error("TrustBluetoothSetupProvider is missing");
  return context;
}

export function walletAuthenticationPrompt(purpose: WalletAuthenticationPurpose, t: Translate): string {
  switch (purpose) {
    case "signMessage": return t("authenticationSignMessage");
    case "signTransaction": return t("authenticationSignTransaction");
    case "viewMnemonic": return t("authenticationViewMnemonic");
    case "viewPrivateKey": return t("authenticationViewPrivateKey");
    case "enableBiometrics": return t("authenticationEnableBiometrics");
    default: return t("authenticationUseWallet");
  }
}

export function formatKhieError(error: KhieProviderSessionError, t: Translate): string {
  return error.kind === "incompatible-pairing-code" ? t("scanPairingCodeFromConnector") : error.message;
}
