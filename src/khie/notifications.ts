import * as Notifications from "expo-notifications";

const CONNECTION_CHANNEL_ID = "khie-connection";
const REQUEST_CHANNEL_ID = "khie-request";
const CONNECTION_CATEGORY_ID = "khie_connected";
const REQUEST_CATEGORY_ID = "khie_request";
const CONNECTION_NOTIFICATION_ID = "khie-connection";
const REQUEST_NOTIFICATION_ID = "khie-request";

export const KHIE_NOTIFICATION_ACTION_UNPAIR = "khie_unpair";
export const KHIE_NOTIFICATION_ACTION_ALLOW = "khie_allow";
export const KHIE_NOTIFICATION_ACTION_DENY = "khie_deny";

type KhieNotificationKind = "connection" | "request";

export type KhieNotificationPermission = "granted" | "prompt" | "denied";

export type KhieNotificationCopy = {
  connectionChannel: string;
  requestChannel: string;
  unpair: string;
  allow: string;
  deny: string;
};

export type KhieNotificationInteraction =
  | { type: "open" }
  | { type: "unpair" }
  | { type: "respond"; approvalId: number; approved: boolean };

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isRequest =
      notification.request.content.data?.khieNotification === "request";
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: isRequest,
      shouldSetBadge: false,
      priority: isRequest
        ? Notifications.AndroidNotificationPriority.HIGH
        : Notifications.AndroidNotificationPriority.LOW,
    };
  },
});

export async function configureKhieNotifications(
  copy: KhieNotificationCopy,
): Promise<void> {
  await Promise.all([
    Notifications.setNotificationChannelAsync(CONNECTION_CHANNEL_ID, {
      name: copy.connectionChannel,
      description: copy.connectionChannel,
      importance: Notifications.AndroidImportance.LOW,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      showBadge: false,
      sound: null,
      enableVibrate: false,
    }),
    Notifications.setNotificationChannelAsync(REQUEST_CHANNEL_ID, {
      name: copy.requestChannel,
      description: copy.requestChannel,
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      showBadge: false,
      enableVibrate: false,
    }),
    Notifications.setNotificationCategoryAsync(CONNECTION_CATEGORY_ID, [
      {
        identifier: KHIE_NOTIFICATION_ACTION_UNPAIR,
        buttonTitle: copy.unpair,
        options: { isDestructive: true, opensAppToForeground: false },
      },
    ]),
    Notifications.setNotificationCategoryAsync(REQUEST_CATEGORY_ID, [
      {
        identifier: KHIE_NOTIFICATION_ACTION_DENY,
        buttonTitle: copy.deny,
        options: { isDestructive: true, opensAppToForeground: false },
      },
      {
        identifier: KHIE_NOTIFICATION_ACTION_ALLOW,
        buttonTitle: copy.allow,
        options: {
          isAuthenticationRequired: true,
          opensAppToForeground: true,
        },
      },
    ]),
  ]);
}

export async function getKhieNotificationPermission(): Promise<KhieNotificationPermission> {
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted) return "granted";
  return permission.canAskAgain ? "prompt" : "denied";
}

export async function requestKhieNotificationPermission(): Promise<KhieNotificationPermission> {
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.granted) return "granted";
  return permission.canAskAgain ? "prompt" : "denied";
}

export async function showKhieConnectionNotification(
  title: string,
  body: string,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: CONNECTION_NOTIFICATION_ID,
    content: {
      title,
      body,
      autoDismiss: false,
      categoryIdentifier: CONNECTION_CATEGORY_ID,
      color: "#315DA8",
      data: { khieNotification: "connection" satisfies KhieNotificationKind },
      priority: Notifications.AndroidNotificationPriority.LOW,
      sound: false,
      sticky: true,
    },
    trigger: { channelId: CONNECTION_CHANNEL_ID },
  });
}

export async function showKhieRequestNotification(
  approvalId: number,
  title: string,
  body: string,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: REQUEST_NOTIFICATION_ID,
    content: {
      title,
      body,
      autoDismiss: true,
      categoryIdentifier: REQUEST_CATEGORY_ID,
      color: "#315DA8",
      data: {
        approvalId,
        khieNotification: "request" satisfies KhieNotificationKind,
      },
      priority: Notifications.AndroidNotificationPriority.HIGH,
      sound: true,
    },
    trigger: { channelId: REQUEST_CHANNEL_ID },
  });
}

export async function dismissKhieConnectionNotification(): Promise<void> {
  await Notifications.dismissNotificationAsync(CONNECTION_NOTIFICATION_ID);
}

export async function dismissKhieRequestNotification(): Promise<void> {
  await Notifications.dismissNotificationAsync(REQUEST_NOTIFICATION_ID);
}

export function addKhieNotificationResponseListener(
  listener: (interaction: KhieNotificationInteraction) => void,
): () => void {
  const handle = (response: Notifications.NotificationResponse) => {
    const interaction = parseKhieNotificationResponse(response);
    if (interaction) listener(interaction);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  const previous = Notifications.getLastNotificationResponse();
  if (previous) {
    handle(previous);
    Notifications.clearLastNotificationResponse();
  }
  return () => subscription.remove();
}

export function parseKhieNotificationResponse(
  response: Pick<Notifications.NotificationResponse, "actionIdentifier" | "notification">,
): KhieNotificationInteraction | undefined {
  const data = response.notification.request.content.data ?? {};
  const kind = data.khieNotification;
  if (kind !== "connection" && kind !== "request") return undefined;
  if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    return { type: "open" };
  }
  if (
    kind === "connection" &&
    response.actionIdentifier === KHIE_NOTIFICATION_ACTION_UNPAIR
  ) {
    return { type: "unpair" };
  }
  const approvalId = data.approvalId;
  if (
    kind !== "request" ||
    typeof approvalId !== "number" ||
    !Number.isSafeInteger(approvalId)
  ) {
    return undefined;
  }
  if (response.actionIdentifier === KHIE_NOTIFICATION_ACTION_ALLOW) {
    return { type: "respond", approvalId, approved: true };
  }
  if (response.actionIdentifier === KHIE_NOTIFICATION_ACTION_DENY) {
    return { type: "respond", approvalId, approved: false };
  }
  return undefined;
}
