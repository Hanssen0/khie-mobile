package expo.modules.khiebackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import java.util.concurrent.atomic.AtomicBoolean

class KhieConnectionService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP_PAIRING) {
      onStopPairing?.invoke()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "Khie is connected" }
    val body = intent?.getStringExtra(EXTRA_BODY).orEmpty().ifBlank {
      "Keeping the Khie connection active in the background"
    }
    val channelName = intent?.getStringExtra(EXTRA_CHANNEL_NAME).orEmpty().ifBlank {
      "Khie connections"
    }
    val stopPairingLabel = intent?.getStringExtra(EXTRA_STOP_PAIRING_LABEL)
    ensureChannel(channelName)
    startForeground(NOTIFICATION_ID, notification(title, body, stopPairingLabel))

    return if (taskStarted.compareAndSet(false, true)) {
      super.onStartCommand(intent, flags, startId)
    } else {
      START_REDELIVER_INTENT
    }
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      TASK_NAME,
      Arguments.createMap(),
      0,
      true,
    )

  override fun onDestroy() {
    taskStarted.set(false)
    super.onDestroy()
  }

  private fun ensureChannel(name: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      CHANNEL_ID,
      name,
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = name
      setShowBadge(false)
      setSound(null, null)
      enableVibration(false)
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    }
    manager.createNotificationChannel(channel)
  }

  private fun notification(
    title: String,
    body: String,
    stopPairingLabel: String?,
  ): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 }
      ?: applicationInfo.icon
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(icon)
      .setContentTitle(title)
      .setContentText(body)
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
    if (!stopPairingLabel.isNullOrBlank()) {
      val stopIntent = Intent(this, KhieConnectionService::class.java).apply {
        action = ACTION_STOP_PAIRING
      }
      val stopPendingIntent = PendingIntent.getService(
        this,
        STOP_PAIRING_REQUEST_CODE,
        stopIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      builder.addAction(0, stopPairingLabel, stopPendingIntent)
    }
    return builder.build()
  }

  companion object {
    private const val TASK_NAME = "KhieConnectionKeepAlive"
    private const val CHANNEL_ID = "khie-connection"
    private const val NOTIFICATION_ID = 0x4B48
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_CHANNEL_NAME = "channelName"
    private const val EXTRA_STOP_PAIRING_LABEL = "stopPairingLabel"
    private const val ACTION_STOP_PAIRING =
      "expo.modules.khiebackground.action.STOP_PAIRING"
    private const val STOP_PAIRING_REQUEST_CODE = 0x4B49
    private val taskStarted = AtomicBoolean(false)
    var onStopPairing: (() -> Unit)? = null

    fun intent(
      context: Context,
      title: String,
      body: String,
      channelName: String,
      stopPairingLabel: String?,
    ) =
      Intent(context, KhieConnectionService::class.java).apply {
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_BODY, body)
        putExtra(EXTRA_CHANNEL_NAME, channelName)
        putExtra(EXTRA_STOP_PAIRING_LABEL, stopPairingLabel)
      }
  }
}
