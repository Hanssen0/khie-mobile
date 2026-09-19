import { SignerCkbPublicKey } from "@ckb-ccc/core";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, View } from "react-native";
import { Button as PaperButton, Card as PaperCard, Divider, HelperText, Icon, IconButton, List, Portal, Dialog, SegmentedButtons, Switch, Text } from "react-native-paper";
import { KeyboardAvoidingView, KeyboardAwareScrollView, KeyboardController } from "react-native-keyboard-controller";

import { useI18n } from "../i18n";
import { type NetworkRpcUrls, clientForNetwork, isRpcUrl, DEFAULT_NETWORK_RPC_URLS } from "../wallet/network";
import { MIN_WALLET_PASSWORD_LENGTH } from "../wallet/password";
import type { Network, WalletProfile } from "../wallet/types";
import { type LocalMnemonicSigningBackend } from "../wallet/localMnemonicBackend";
import { type ThemePreference } from "../storage/themeSettings";
import { type UpdateSettings } from "../storage/updateSettings";
import { type ReleaseAsset, GITHUB_REPOSITORY_URL } from "../update/githubRelease";
import { errorMessage, KeyboardDialogContent, useAppDialog, WalletTextInput } from "./components";
import { useDeveloperMode } from "./developerMode";
import { LanguageMenu, NetworkSwitch, walletLabel } from "./navigation";
import { styles } from "./styles";

const SECRET_REVEAL_TIMEOUT_MS = 60_000;

export function SettingsScreen({ backend, network, profile, wallets, rpcUrls, themePreference, updateSettings, checkingForUpdates, currentVersion, buildCommit, appArchitecture, updateAvailable, updateAsset, biometricAvailable, biometricUnlock, masterPasswordSet, onChangeNetwork, onChangeBiometricUnlock, onChangeMasterPassword, onSelectWallet, onAddWallet, onRemoveWallet, onSaveRpcUrls, onChangeThemePreference, onChangeAutomaticUpdateChecks, onCheckForUpdates, onDownloadUpdate }: {
  backend?: LocalMnemonicSigningBackend; network: Network; profile: WalletProfile; wallets: WalletProfile[]; rpcUrls: NetworkRpcUrls; themePreference: ThemePreference; updateSettings: UpdateSettings; checkingForUpdates: boolean; currentVersion: string; buildCommit: string; appArchitecture: string; updateAvailable: boolean; updateAsset?: ReleaseAsset; biometricAvailable: boolean; biometricUnlock: boolean; masterPasswordSet: boolean;
  onChangeNetwork: (network: Network) => void; onChangeBiometricUnlock: (enabled: boolean) => Promise<void>; onChangeMasterPassword: (oldPassword: string, newPassword: string) => Promise<void>; onSelectWallet: (walletId: string) => Promise<void>; onAddWallet: () => void; onRemoveWallet: (walletId: string) => Promise<void>; onSaveRpcUrls: (urls: NetworkRpcUrls) => Promise<void>; onChangeThemePreference: (preference: ThemePreference) => Promise<void>; onChangeAutomaticUpdateChecks: (enabled: boolean) => Promise<void>; onCheckForUpdates: () => Promise<void> | void; onDownloadUpdate: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { developerMode, setDeveloperMode } = useDeveloperMode();
  const appDialog = useAppDialog();
  const isFocused = useIsFocused();
  const revealController = useRef<AbortController | undefined>(undefined);
  const revealGeneration = useRef(0);
  const [secret, setSecret] = useState<{ label: string; value: string }>();
  const [rpcDraft, setRpcDraft] = useState<NetworkRpcUrls>(rpcUrls);
  const [savingRpcUrls, setSavingRpcUrls] = useState(false);
  const [updatingBiometrics, setUpdatingBiometrics] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [walletAddresses, setWalletAddresses] = useState<Record<string, string>>({});
  const invalidateSecret = useCallback(() => {
    const error = new Error("Secret reveal was cancelled");
    error.name = "AbortError";
    revealController.current?.abort(error);
    revealController.current = undefined;
    revealGeneration.current += 1;
    setSecret(undefined);
  }, []);
  useEffect(() => {
    if (!isFocused) invalidateSecret();
    return () => {
      const error = new Error("Secret reveal was cancelled");
      error.name = "AbortError";
      revealController.current?.abort(error);
      revealController.current = undefined;
      revealGeneration.current += 1;
    };
  }, [invalidateSecret, isFocused]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") invalidateSecret();
    });
    return () => subscription.remove();
  }, [invalidateSecret]);
  useEffect(() => invalidateSecret(), [backend, invalidateSecret, profile.id]);
  useEffect(() => {
    if (!secret) return;
    const timeout = setTimeout(invalidateSecret, SECRET_REVEAL_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [invalidateSecret, secret]);
  useEffect(() => setRpcDraft(rpcUrls), [rpcUrls]);
  useEffect(() => {
    let active = true; setWalletAddresses({}); const client = clientForNetwork(network, rpcUrls[network]);
    for (const wallet of wallets) if (wallet.kind === "mnemonic") void new SignerCkbPublicKey(client, wallet.publicKey).getRecommendedAddress().then((address) => {
      if (active) setWalletAddresses((current) => ({ ...current, [wallet.id]: address }));
    }).catch(() => { if (active) setWalletAddresses((current) => ({ ...current, [wallet.id]: t("addressReadFailed") })); });
    return () => { active = false; };
  }, [network, rpcUrls, t, wallets]);
  const testnetRpcValid = isRpcUrl(rpcDraft.testnet); const mainnetRpcValid = isRpcUrl(rpcDraft.mainnet);
  const rpcUrlsChanged = rpcDraft.testnet.trim() !== rpcUrls.testnet || rpcDraft.mainnet.trim() !== rpcUrls.mainnet;
  const applyRpcUrls = async (next: NetworkRpcUrls) => { setSavingRpcUrls(true); try { await onSaveRpcUrls(next); } catch (cause) { appDialog.show(t("unableToSave"), errorMessage(cause, t)); } finally { setSavingRpcUrls(false); } };
  const toggleBiometricUnlock = () => { if (updatingBiometrics || !biometricAvailable) return; setUpdatingBiometrics(true); void onChangeBiometricUnlock(!biometricUnlock).catch((cause: unknown) => appDialog.show(t("unableToSave"), errorMessage(cause, t))).finally(() => setUpdatingBiometrics(false)); };
  const reveal = async (kind: "mnemonic" | "privateKey") => {
    if (!backend || !isFocused || AppState.currentState !== "active") return;
    invalidateSecret();
    const generation = revealGeneration.current;
    const controller = new AbortController();
    revealController.current = controller;
    const assertActive = () => {
      controller.signal.throwIfAborted();
      if (
        revealGeneration.current !== generation ||
        !isFocused ||
        AppState.currentState !== "active"
      ) {
        const error = new Error("Secret reveal is no longer active");
        error.name = "AbortError";
        throw error;
      }
    };
    const requestBackend = backend.forRequest(
      controller.signal,
      assertActive,
    );
    try {
      const value = kind === "mnemonic"
        ? await requestBackend.exportMnemonic()
        : await requestBackend.exportPrivateKey();
      if (
        revealGeneration.current !== generation ||
        !isFocused ||
        AppState.currentState !== "active"
      ) return;
      setSecret({
        label: kind === "mnemonic" ? t("mnemonic") : t("privateKey"),
        value,
      });
    } catch (cause) {
      if (
        revealGeneration.current === generation &&
        isFocused &&
        AppState.currentState === "active"
      ) {
        appDialog.show(t("unableToDisplay"), errorMessage(cause, t));
      }
    } finally {
      if (revealController.current === controller) {
        revealController.current = undefined;
      }
    }
  };
  const confirmRemove = (wallet: WalletProfile) => appDialog.confirm({ title: t("deleteWalletTitle", { wallet: walletLabel(wallets, wallet.id, t) }), message: t(wallet.kind === "cryptape-trust" ? "removeTrustWalletDescription" : "deleteWalletDescription"), cancelLabel: t("cancel"), confirmLabel: t("delete"), destructive: true, onConfirm: () => { void onRemoveWallet(wallet.id).catch((cause: unknown) => appDialog.show(t("unableToDeleteWallet"), errorMessage(cause, t))); } });
  return <>
    <KeyboardAwareScrollView bottomOffset={16} contentContainerStyle={[styles.page, styles.settingsPage]} keyboardShouldPersistTaps="handled">
      <Text variant="headlineMedium">{t("settingsAndExport")}</Text>
      <PaperCard mode="elevated"><PaperCard.Title title={t("network")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="web" />} /><PaperCard.Content><NetworkSwitch value={network} onChange={onChangeNetwork} /></PaperCard.Content></PaperCard>
      <PaperCard mode="elevated"><PaperCard.Title title={t("wallets")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="wallet" />} />
        <PaperCard.Content style={styles.walletListContent}>{wallets.map((wallet) => { const selected = wallet.id === profile.id; const walletDetail = wallet.kind === "cryptape-trust" ? wallet.deviceId : walletAddresses[wallet.id] ?? t("addressGenerating"); return <List.Item key={wallet.id} style={styles.walletListItem} title={walletLabel(wallets, wallet.id, t)} description={selected ? `${t("current")} · ${walletDetail}` : walletDetail} descriptionEllipsizeMode="middle" descriptionNumberOfLines={1} left={(props) => <List.Icon {...props} icon={selected ? "wallet" : "wallet-outline"} />} right={(props) => <IconButton icon="delete-outline" accessibilityLabel={t("delete")} style={[props.style, styles.walletDeleteButton]} onPress={() => confirmRemove(wallet)} />} onPress={() => { if (!selected) void onSelectWallet(wallet.id).catch((cause: unknown) => appDialog.show(t("unableToSwitchWallet"), errorMessage(cause, t))); }} />; })}</PaperCard.Content>
        <PaperCard.Actions style={styles.cardActions}><PaperButton mode="contained" icon="plus" onPress={onAddWallet}>{t("addWallet")}</PaperButton></PaperCard.Actions>
      </PaperCard>
      {masterPasswordSet ? <PaperCard mode="elevated"><PaperCard.Title title={t("security")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="shield-lock" />} /><PaperCard.Content><List.Item accessibilityRole="switch" accessibilityState={{ checked: biometricUnlock, disabled: updatingBiometrics || !biometricAvailable }} title={t("biometricUnlock")} description={({ color, fontSize }) => <Text style={{ color, fontSize }}>{biometricAvailable ? t("biometricUnlockDescription") : t("biometricUnlockUnavailable")}</Text>} left={(props) => <List.Icon {...props} icon="fingerprint" style={[props.style, styles.listItemCenteredAccessory]} />} right={(props) => <View pointerEvents="none" style={[props.style, styles.listItemCenteredAccessory]}><Switch disabled={updatingBiometrics || !biometricAvailable} value={biometricUnlock} /></View>} onPress={toggleBiometricUnlock} /></PaperCard.Content><PaperCard.Actions style={styles.cardActions}><PaperButton mode="contained" icon="key-change" onPress={() => setChangePasswordOpen(true)}>{t("changeMasterPassword")}</PaperButton></PaperCard.Actions></PaperCard> : null}
      <PaperCard mode="elevated"><PaperCard.Title title={t("language")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="translate" />} /><PaperCard.Content><LanguageMenu /></PaperCard.Content></PaperCard>
      <PaperCard mode="elevated"><PaperCard.Title title={t("appearance")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="theme-light-dark" />} /><PaperCard.Content><SegmentedButtons value={themePreference} onValueChange={(value) => void onChangeThemePreference(value as ThemePreference).catch((cause) => appDialog.show(t("unableToSave"), errorMessage(cause, t)))} buttons={[{ value: "system", label: t("systemTheme"), showSelectedCheck: false }, { value: "light", label: t("lightTheme"), showSelectedCheck: false }, { value: "dark", label: t("darkTheme"), showSelectedCheck: false }]} /></PaperCard.Content></PaperCard>
      {developerMode ? <Text variant="titleMedium">{t("advancedSettings")}</Text> : null}
      {developerMode ? <PaperCard mode="elevated"><PaperCard.Title title={t("networkRpc")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="server-network" />} /><PaperCard.Content>
        <WalletTextInput label={t("testnetRpcUrl")} autoCapitalize="none" autoCorrect={false} keyboardType="url" value={rpcDraft.testnet} error={!testnetRpcValid} onChangeText={(testnet) => setRpcDraft((current) => ({ ...current, testnet }))} /><HelperText type="error" visible={!testnetRpcValid}>{t("invalidRpcUrl")}</HelperText>
        <WalletTextInput label={t("mainnetRpcUrl")} autoCapitalize="none" autoCorrect={false} keyboardType="url" value={rpcDraft.mainnet} error={!mainnetRpcValid} onChangeText={(mainnet) => setRpcDraft((current) => ({ ...current, mainnet }))} /><HelperText type="error" visible={!mainnetRpcValid}>{t("invalidRpcUrl")}</HelperText>
      </PaperCard.Content><PaperCard.Actions style={styles.cardActions}><PaperButton mode="text" disabled={savingRpcUrls} onPress={() => void applyRpcUrls({ ...DEFAULT_NETWORK_RPC_URLS })}>{t("restoreDefaults")}</PaperButton><PaperButton mode="contained" loading={savingRpcUrls} disabled={savingRpcUrls || !rpcUrlsChanged || !testnetRpcValid || !mainnetRpcValid} onPress={() => void applyRpcUrls(rpcDraft)}>{t("save")}</PaperButton></PaperCard.Actions></PaperCard> : null}
      {profile.kind === "mnemonic" && backend ? <PaperCard mode="elevated"><PaperCard.Title title={developerMode ? t("accountInformation") : t("mnemonic")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="account-key" />} /><PaperCard.Content style={styles.cardContent}>{developerMode ? <><View style={styles.metadataBlock}><Text variant="labelMedium">{t("derivationPath")}</Text><Text variant="bodyMedium" selectable style={styles.mono}>{profile.derivationPath}</Text></View><Divider /><View style={styles.metadataBlock}><Text variant="labelMedium">{t("publicKey")}</Text><Text variant="bodySmall" selectable style={styles.mono}>{profile.publicKey}</Text></View></> : <Text variant="bodyMedium">{t("backupWarning")}</Text>}</PaperCard.Content><PaperCard.Actions style={styles.cardActions}>{developerMode ? <PaperButton mode="text" icon="eye-lock" onPress={() => void reveal("privateKey")}>{t("viewPrivateKey")}</PaperButton> : null}<PaperButton mode="contained" icon="eye-lock" onPress={() => void reveal("mnemonic")}>{t("viewMnemonic")}</PaperButton></PaperCard.Actions></PaperCard> : null}
      {profile.kind === "mnemonic" && secret ? <PaperCard mode="contained"><PaperCard.Title title={secret.label} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="shield-key" />} /><PaperCard.Content><Text variant="bodyMedium" selectable style={styles.mono}>{secret.value}</Text></PaperCard.Content><PaperCard.Actions style={styles.cardActions}><PaperButton mode="text" icon="eye-off" onPress={invalidateSecret}>{t("hide")}</PaperButton></PaperCard.Actions></PaperCard> : null}
      {profile.kind === "mnemonic" ? <HelperText type="error" visible>{t("exportWarning")}</HelperText> : null}
      <PaperCard mode="elevated"><PaperCard.Title title={t("appInformation")} leftStyle={styles.cardTitleLeft} left={(props) => <Icon {...props} source="information-outline" />} /><PaperCard.Content style={styles.cardContent}>
        <List.Item style={styles.appInformationLink} title={t("githubRepository")} description={GITHUB_REPOSITORY_URL} descriptionNumberOfLines={1} descriptionEllipsizeMode="middle" left={(props) => <List.Icon {...props} icon="github" />} right={(props) => <List.Icon {...props} icon="open-in-new" />} onPress={() => void Linking.openURL(GITHUB_REPOSITORY_URL)} /><Divider />
        <AppInformationRow label={t("currentVersion")} value={currentVersion.startsWith("v") ? currentVersion : `v${currentVersion}`} /><AppInformationRow label={t("latestVersion")} value={checkingForUpdates ? t("checkingForUpdates") : updateSettings.latestRelease?.tagName ?? t("notChecked")} />{developerMode ? <><AppInformationRow label={t("buildCommit")} value={buildCommit} mono /><AppInformationRow label={t("appArchitecture")} value={appArchitecture || t("unknown")} /><AppInformationRow label={t("lastChecked")} value={updateSettings.lastCheckedAt ? new Date(updateSettings.lastCheckedAt).toLocaleString() : t("notChecked")} /></> : null}
        {updateSettings.latestRelease ? <View style={styles.updateStatus}><Icon source={updateAvailable ? "arrow-up-circle-outline" : "check-circle-outline"} size={20} /><Text variant="bodyMedium" style={styles.updateStatusText}>{updateAvailable ? t("updateAvailableStatus", { version: updateSettings.latestRelease.tagName }) : t("appIsUpToDate")}</Text></View> : null}
        {developerMode && updateAvailable && updateAsset ? <Text variant="bodySmall" selectable style={styles.mono}>{updateAsset.name}</Text> : null}<Divider />
        <List.Item accessibilityRole="switch" accessibilityState={{ checked: updateSettings.automaticChecks }} style={styles.appInformationSwitch} title={t("automaticUpdateChecks")} right={() => <View pointerEvents="none"><Switch value={updateSettings.automaticChecks} /></View>} onPress={() => void onChangeAutomaticUpdateChecks(!updateSettings.automaticChecks).catch((cause) => appDialog.show(t("unableToSave"), errorMessage(cause, t)))} />
        <List.Item accessibilityRole="switch" accessibilityState={{ checked: developerMode }} style={styles.appInformationSwitch} title={t("developerMode")} description={t("developerModeDescription")} right={() => <View pointerEvents="none"><Switch value={developerMode} /></View>} onPress={() => setDeveloperMode(!developerMode)} />
      </PaperCard.Content><PaperCard.Actions style={styles.cardActions}><PaperButton mode="text" icon="refresh" loading={checkingForUpdates} disabled={checkingForUpdates} onPress={() => void onCheckForUpdates()}>{t("checkForUpdates")}</PaperButton><PaperButton mode="contained" icon="download" disabled={!updateAvailable} onPress={() => void onDownloadUpdate()}>{t("downloadUpdate")}</PaperButton></PaperCard.Actions></PaperCard>
    </KeyboardAwareScrollView>
    <ChangeMasterPasswordDialog visible={changePasswordOpen} onDismiss={() => setChangePasswordOpen(false)} onSubmit={onChangeMasterPassword} />
  </>;
}

function ChangeMasterPasswordDialog({ visible, onDismiss, onSubmit }: { visible: boolean; onDismiss: () => void; onSubmit: (oldPassword: string, newPassword: string) => Promise<void> }) {
  const { t } = useI18n(); const [oldPassword, setOldPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState(""); const [changing, setChanging] = useState(false); const [error, setError] = useState<string>();
  useEffect(() => { if (!visible) { setOldPassword(""); setNewPassword(""); setConfirmPassword(""); setError(undefined); } }, [visible]);
  const newPasswordTooShort = newPassword.length > 0 && [...newPassword].length < MIN_WALLET_PASSWORD_LENGTH; const passwordsDoNotMatch = confirmPassword.length > 0 && confirmPassword !== newPassword; const valid = oldPassword.length > 0 && [...newPassword].length >= MIN_WALLET_PASSWORD_LENGTH && confirmPassword === newPassword;
  const submit = async () => { if (!valid || changing) return; setChanging(true); setError(undefined); try { await onSubmit(oldPassword, newPassword); onDismiss(); void KeyboardController.dismiss({ animated: true }); } catch (cause) { setError(errorMessage(cause, t)); } finally { setChanging(false); } };
  return <Portal><KeyboardAvoidingView behavior="height" pointerEvents="box-none" style={styles.keyboardDialogLayer}><Dialog visible={visible} dismissable={false} style={styles.keyboardDialog}><Dialog.Title>{t("changeMasterPassword")}</Dialog.Title><KeyboardDialogContent>
    <WalletTextInput autoFocus label={t("currentWalletPassword")} secureTextEntry value={oldPassword} onChangeText={(value) => { setOldPassword(value); setError(undefined); }} />
    <WalletTextInput label={t("newWalletPassword")} secureTextEntry value={newPassword} onChangeText={setNewPassword} />{newPasswordTooShort ? <HelperText type="error" visible>{t("walletPasswordTooShort")}</HelperText> : null}
    <WalletTextInput label={t("confirmWalletPassword")} returnKeyType="done" secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} onSubmitEditing={() => void submit()} />{passwordsDoNotMatch ? <HelperText type="error" visible>{t("walletPasswordsDoNotMatch")}</HelperText> : null}{error ? <HelperText type="error" visible>{error}</HelperText> : null}
  </KeyboardDialogContent><Dialog.Actions style={styles.dialogActions}><PaperButton contentStyle={styles.extraHorizontalButtonPadding} disabled={changing} onPress={() => { onDismiss(); void KeyboardController.dismiss({ animated: true }); }}>{t("cancel")}</PaperButton><PaperButton mode="contained" contentStyle={styles.extraHorizontalButtonPadding} loading={changing} disabled={!valid || changing} onPress={() => void submit()}>{t("changePassword")}</PaperButton></Dialog.Actions></Dialog></KeyboardAvoidingView></Portal>;
}

function AppInformationRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <View style={styles.appInformationRow}><Text variant="labelMedium" style={styles.appInformationLabel}>{label}</Text><Text variant="bodyMedium" selectable style={[styles.appInformationValue, mono && styles.mono]}>{value}</Text></View>;
}
