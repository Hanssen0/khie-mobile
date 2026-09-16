import { useEffect, useState } from "react";
import { BackHandler, Linking, ScrollView, View } from "react-native";
import { ActivityIndicator, Card as PaperCard, Chip, HelperText, Icon, List, Button as PaperButton, Switch, Text, useTheme } from "react-native-paper";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { KhieIcon } from "../components/KhieIcon";
import { useI18n } from "../i18n";
import { type SecureStoreWalletVault, type WalletCredential } from "../storage/walletVault";
import { type TrustDevice } from "../trust/native";
import { assertValidMnemonic } from "../wallet/derivation";
import { createMnemonicChallenges, type MnemonicChallenge } from "../wallet/mnemonicChallenge";
import { MIN_WALLET_PASSWORD_LENGTH } from "../wallet/password";
import { generateMnemonic, persistFirstMnemonicWallet, persistWallet } from "../wallet/walletService";
import { type WalletState } from "../wallet/types";
import { BackButton, LinkButton, PrimaryButton, SecondaryButton, WalletTextInput } from "./components";
import { LanguageMenu } from "./navigation";
import { styles } from "./styles";
import type { Onboarding } from "./types";
import { TrustWalletBanner, TrustWalletPicker } from "./TrustDeviceScreen";

export function OnboardingScreen({ mode, vault, hasMasterPassword, onUnlockMasterPassword, onMode, onComplete, onConnectTrust, onCancel, onError }: {
  mode: Onboarding;
  vault: SecureStoreWalletVault;
  hasMasterPassword: boolean;
  onUnlockMasterPassword: () => Promise<WalletCredential>;
  onMode: (mode: Onboarding) => void;
  onComplete: (state: WalletState) => Promise<void> | void;
  onConnectTrust: (device: TrustDevice) => Promise<void>;
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
  const [passwordMnemonic, setPasswordMnemonic] = useState("");
  const [passwordSource, setPasswordSource] = useState<"create" | "restore">("create");
  const [newWalletPassword, setNewWalletPassword] = useState("");
  const [confirmWalletPassword, setConfirmWalletPassword] = useState("");
  const [enableBiometricUnlock, setEnableBiometricUnlock] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === "start" && !onCancel) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (mode === "confirm") onMode("create");
      else if (mode === "password") onMode(passwordSource);
      else if (mode !== "start") onMode("start");
      else onCancel?.();
      return true;
    });
    return () => subscription.remove();
  }, [mode, onCancel, onMode, passwordSource]);

  const beginCreate = async () => {
    setBusy(true);
    try { setGeneratedMnemonic(await generateMnemonic()); onMode("create"); }
    catch (cause) { onError(cause); }
    finally { setBusy(false); }
  };
  const beginPasswordSetup = async (value: string, source: "create" | "restore") => {
    try {
      const mnemonic = assertValidMnemonic(value);
      if (hasMasterPassword) {
        setBusy(true);
        const credential = await onUnlockMasterPassword();
        await onComplete(await persistWallet(vault, mnemonic, credential));
        return;
      }
      setPasswordMnemonic(mnemonic);
      setPasswordSource(source);
      setNewWalletPassword("");
      setConfirmWalletPassword("");
      setEnableBiometricUnlock(vault.canUseBiometrics());
      onMode("password");
    } catch (cause) { onError(cause); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try { await onComplete(await persistFirstMnemonicWallet(vault, passwordMnemonic, newWalletPassword, enableBiometricUnlock)); }
    catch (cause) { onError(cause); }
    finally { setBusy(false); }
  };
  const beginConfirmation = () => { setChallenges(createMnemonicChallenges(generatedMnemonic)); setChallengeIndex(0); setChallengeError(false); onMode("confirm"); };
  const answerChallenge = (answer: string) => {
    const challenge = challenges[challengeIndex];
    if (!challenge || busy) return;
    if (answer === challenge.answer) {
      if (challengeIndex + 1 < challenges.length) { setChallengeIndex(challengeIndex + 1); setChallengeError(false); }
      else void beginPasswordSetup(generatedMnemonic, "create");
      return;
    }
    setChallengeError(true);
  };

  if (mode === "start") {
    if (!onCancel) return <View style={styles.onboardingStart}><View style={styles.onboardingContent}>
      <KhieIcon size={64} color={theme.colors.primary} />
      <Text variant="displaySmall">Khie Wallet</Text>
      <Text variant="bodyLarge" style={styles.centerText}>{t("tagline")}</Text>
      <PrimaryButton label={t("createWallet")} onPress={() => void beginCreate()} disabled={busy} />
      <SecondaryButton label={t("restoreWallet")} onPress={() => onMode("restore")} />
      <LinkButton label={t("connectTrustWallet")} onPress={() => onMode("trust")} />
      <PaperCard mode="elevated" style={styles.onboardingSafetyNotice}>
        <PaperCard.Content style={styles.onboardingSafetyNoticeContent}>
          <Icon source="shield-alert-outline" size={20} color={theme.colors.primary} />
          <View style={styles.onboardingSafetyNoticeCopy}>
            <Text variant="titleSmall" style={{ color: theme.colors.onSurface }}>{t("safetyNoticeTitle")}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>{t("safetyNotice")}</Text>
          </View>
        </PaperCard.Content>
      </PaperCard>
    </View><LanguageMenu /></View>;
    return <View style={styles.onboardingStart}>
      <BackButton onPress={onCancel} />
      <View style={styles.onboardingContent}>
        <KhieIcon size={64} color={theme.colors.primary} />
        <Text variant="displaySmall">{t("addWallet")}</Text>
        <PrimaryButton label={t("createWallet")} onPress={() => void beginCreate()} disabled={busy} />
        <SecondaryButton label={t("restoreWallet")} onPress={() => onMode("restore")} />
        <LinkButton label={t("connectTrustWallet")} onPress={() => onMode("trust")} />
      </View>
    </View>;
  }
  if (mode === "trust") return <ScrollView contentContainerStyle={styles.page}>
    <BackButton onPress={() => onMode("start")} />
    <TrustWalletBanner />
    <Text variant="headlineMedium">{t("connectTrustWallet")}</Text>
    <View style={[styles.trustRiskNotice, { backgroundColor: theme.colors.surfaceVariant }]}>
      <View style={styles.trustRiskNoticeHeader}><Icon source="information-outline" size={24} color={theme.colors.primary} />
        <Text variant="titleMedium" style={[styles.flex, { color: theme.colors.onSurfaceVariant }]}>{t("trustRiskTitle")}</Text>
      </View>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t("trustRiskDescription")}</Text>
      <PaperButton compact mode="text" icon="open-in-new" style={styles.trustRiskLink} textColor={theme.colors.primary} onPress={() => void Linking.openURL("https://github.com/cryptape/trust-android").catch(() => undefined)}>{t("trustOriginalRepository")}</PaperButton>
    </View>
    <Text variant="bodyMedium">{t("trustWalletScanHint")}</Text>
    <TrustWalletPicker onConnect={onConnectTrust} />
  </ScrollView>;
  if (mode === "restore") return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <BackButton onPress={() => onMode("start")} />
    <Text variant="headlineMedium">{t("restoreWallet")}</Text>
    <Text variant="bodyMedium">{t("enterMnemonic")}</Text>
    <WalletTextInput style={styles.mnemonicInput} multiline label={t("mnemonic")} autoCapitalize="none" autoCorrect={false} placeholder="word1 word2 …" value={restoreMnemonic} onChangeText={setRestoreMnemonic} />
    <PrimaryButton label={busy ? t("saving") : t("restore")} onPress={() => void beginPasswordSetup(restoreMnemonic, "restore")} disabled={busy} />
  </ScrollView>;
  if (mode === "create") {
    const words = generatedMnemonic.split(" ");
    return <ScrollView contentContainerStyle={styles.page}>
      <BackButton onPress={() => onMode("start")} />
      <Text variant="headlineMedium">{t("backupMnemonic")}</Text>
      <HelperText type="error" visible>{t("backupWarning")}</HelperText>
      <View style={styles.words}>{words.map((word, index) => <Chip key={`${word}-${index}`} compact mode="flat">{index + 1}. {word}</Chip>)}</View>
      <PrimaryButton label={t("continueToVerification")} onPress={beginConfirmation} />
    </ScrollView>;
  }
  if (mode === "password") {
    const passwordTooShort = newWalletPassword.length > 0 && [...newWalletPassword].length < MIN_WALLET_PASSWORD_LENGTH;
    const passwordsDoNotMatch = confirmWalletPassword.length > 0 && confirmWalletPassword !== newWalletPassword;
    const biometricAvailable = vault.canUseBiometrics();
    return <KeyboardAwareScrollView bottomOffset={16} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <BackButton onPress={() => onMode(passwordSource)} />
      <Text variant="headlineMedium">{t("setWalletPassword")}</Text>
      <Text variant="bodyMedium">{t("walletPasswordDescription")}</Text>
      <WalletTextInput autoFocus label={t("walletPassword")} secureTextEntry value={newWalletPassword} onChangeText={setNewWalletPassword} />
      {passwordTooShort ? <HelperText type="error" visible>{t("walletPasswordTooShort")}</HelperText> : null}
      <WalletTextInput label={t("confirmWalletPassword")} secureTextEntry returnKeyType="done" value={confirmWalletPassword} onChangeText={setConfirmWalletPassword} onSubmitEditing={() => {
        if ([...newWalletPassword].length >= MIN_WALLET_PASSWORD_LENGTH && confirmWalletPassword === newWalletPassword && !busy) void save();
      }} />
      {passwordsDoNotMatch ? <HelperText type="error" visible>{t("walletPasswordsDoNotMatch")}</HelperText> : null}
      <List.Item title={t("biometricUnlock")} description={({ color, fontSize }) => <Text style={{ color, fontSize }}>{biometricAvailable ? t("biometricUnlockDescription") : t("biometricUnlockUnavailable")}</Text>} left={(props) => <List.Icon {...props} icon="fingerprint" style={[props.style, styles.listItemCenteredAccessory]} />} right={(props) => <View pointerEvents="none" style={[props.style, styles.listItemCenteredAccessory]}><Switch disabled={!biometricAvailable} value={enableBiometricUnlock} /></View>} onPress={() => { if (biometricAvailable) setEnableBiometricUnlock((value) => !value); }} />
      <PrimaryButton label={busy ? t("saving") : t("saveWallet")} disabled={busy || [...newWalletPassword].length < MIN_WALLET_PASSWORD_LENGTH || confirmWalletPassword !== newWalletPassword} onPress={() => void save()} />
    </KeyboardAwareScrollView>;
  }
  const challenge = challenges[challengeIndex];
  return <ScrollView contentContainerStyle={styles.page}>
    <BackButton onPress={() => onMode("create")} />
    <Text variant="headlineMedium">{t("verifyMnemonic")}</Text>
    <Text variant="labelLarge">{t("mnemonicQuestionProgress", { current: challengeIndex + 1, total: challenges.length || 2 })}</Text>
    <Text variant="bodyLarge">{t("selectMnemonicWord", { number: challenge?.position ?? 1 })}</Text>
    {challengeError ? <HelperText type="error" visible>{t("incorrectMnemonicWord")}</HelperText> : null}
    {challenge?.options.map((option) => <PaperButton key={option} mode="contained-tonal" disabled={busy} onPress={() => answerChallenge(option)}>{option}</PaperButton>)}
    {busy ? <ActivityIndicator /> : null}
  </ScrollView>;
}
