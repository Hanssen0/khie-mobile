package expo.modules.khiebackground

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KhieBackgroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KhieBackgroundService")

    Events("onStopPairing")

    OnCreate {
      KhieConnectionService.onStopPairing = {
        sendEvent("onStopPairing")
      }
    }

    AsyncFunction("start") { title: String, body: String, channelName: String, stopPairingLabel: String? ->
      val context = requireNotNull(appContext.reactContext) {
        "React context is unavailable"
      }
      val intent = KhieConnectionService.intent(
        context,
        title,
        body,
        channelName,
        stopPairingLabel,
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    AsyncFunction("stop") {
      appContext.reactContext?.stopService(
        Intent(appContext.reactContext, KhieConnectionService::class.java),
      )
      Unit
    }

    OnDestroy {
      KhieConnectionService.onStopPairing = null
    }
  }
}
