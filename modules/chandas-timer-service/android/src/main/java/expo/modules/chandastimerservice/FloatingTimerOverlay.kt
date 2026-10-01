package expo.modules.chandastimerservice

import android.app.Activity
import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.net.Uri
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.WindowInsets
import android.view.accessibility.AccessibilityManager
import android.widget.FrameLayout
import androidx.core.os.bundleOf
import com.facebook.react.ReactApplication
import com.facebook.react.interfaces.fabric.ReactSurface
import com.facebook.react.runtime.ReactSurfaceImpl
import org.json.JSONObject

/** Device-only presentation state. The native timer store remains the sole session authority. */
internal object FloatingTimerOverlay {
  private const val PREFS = "chandas-floating-overlay"
  private const val REQUESTED = "requested"
  private const val APPEARANCE = "appearance"
  private const val PREVIEW_MS = 10_000L
  private const val CUE_EXPAND_MS = 5_000L
  private const val COMPACT_WIDTH_DP = 124
  // The visible pill is 40dp tall; retain the 48dp effective touch target.
  private const val COMPACT_TOUCH_HEIGHT_DP = 48
  private val main = Handler(Looper.getMainLooper())
  private val listeners = NativeListenerRegistry<Bundle>()
  private var application: Application? = null
  private var resumedActivity: Activity? = null
  private var activityCreatedInProcess = false
  private var foreground = false
  private var owner: ChandasCountdownService? = null
  private var screenReceiverRegistered = false
  private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
      if (intent?.action == Intent.ACTION_SCREEN_OFF || intent?.action == Intent.ACTION_SCREEN_ON) {
        reconcile(context)
        emitSnapshot(context)
      }
    }
  }
  private var surface: ReactSurface? = null
  private var windowView: FrameLayout? = null
  private var window: WindowManager? = null
  private var params: WindowManager.LayoutParams? = null
  private var overlayHostResumed = false
  private var visible = false
  private var expanded = false
  private var preview = false
  private var previewStartedAt = 0L
  private var cueAttention = false
  private var cuePulse = 0
  private var lastError: String? = null
  private var retryAfter = 0L
  private val collapseTask = Runnable {
    val context = application ?: return@Runnable
    if (visible && expanded) setExpanded(context, false)
  }
  private var lastState: String? = null

  private val lifecycle = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, state: Bundle?) { activityCreatedInProcess = true }
    override fun onActivityStarted(activity: Activity) {
      foreground = true
      reconcile(application ?: return)
    }
    override fun onActivityResumed(activity: Activity) {
      val overlayOwnedHost = overlayHostResumed
      resumedActivity = activity
      foreground = true
      application?.let(ChandasCountdownService::reconcile)
      reconcile(application ?: return)
      if (overlayOwnedHost) main.post {
        // The service temporarily resumed the shared React host with no
        // Activity. Hand its current Activity back after overlay teardown so
        // React Native Modal can attach sheets to a real window again.
        if (resumedActivity === activity) runCatching {
          (application as? ReactApplication)?.reactHost?.let { host ->
            // ReactHost remembers the new Activity on a duplicate resume,
            // but ReactContext does not: its lifecycle manager returns early
            // while already RESUMED from the service's null-Activity resume.
            host.onHostPause()
            host.onHostResume(activity)
          }
        }
      }
    }
    override fun onActivityPaused(activity: Activity) {
      if (resumedActivity === activity) {
        resumedActivity = null
        foreground = false
        reconcile(application ?: return)
      }
    }
    override fun onActivityStopped(activity: Activity) {
      application?.let(ChandasCountdownService::reconcile)
      reconcile(application ?: return)
    }
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
  }

  fun initialize(context: Context, activityVisible: Boolean = false) {
    // A service-owned React surface creates another module instance. Its
    // ActivityProvider can still retain the stopped Activity, so only use the
    // visibility hint while installing the process-wide lifecycle tracker.
    if (application != null) {
      if (activityVisible) {
        activityCreatedInProcess = true
        foreground = true
        main.post { removeWindow() }
      }
      return
    }
    val app = context.applicationContext as Application
    application = app
    foreground = activityVisible
    activityCreatedInProcess = activityVisible
    app.registerActivityLifecycleCallbacks(lifecycle)
    AlarmStateRegistry.add { reconcile(app); emitSnapshot(app) }
    TimerStateRegistry.add { reconcile(app); emitSnapshot(app) }
    TimerControlRegistry.add { emitSnapshot(app) }
  }

  fun addListener(listener: (Bundle) -> Unit) = listeners.add(listener)
  fun removeListener(listener: (Bundle) -> Unit) = listeners.remove(listener)

  fun requested(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(REQUESTED, false)
  fun permitted(context: Context): Boolean = Build.VERSION.SDK_INT >= 26 && Settings.canDrawOverlays(context)

  private fun screenInteractive(context: Context): Boolean =
    (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
  fun needsService(context: Context): Boolean = requested(context) && permitted(context) && TimerStateStore.load(context) != null

  fun setRequested(context: Context, value: Boolean) {
    initialize(context)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(REQUESTED, value).apply()
    retryAfter = 0L
    if (!value) main.post { removeWindow() }
    ChandasCountdownService.reconcile(context)
    emit(context)
  }

  fun openSettings(context: Context) {
    context.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  fun serviceStartFailed(context: Context) {
    lastError = "service-start"
    emit(context)
  }

  fun preview(context: Context): Boolean {
    initialize(context)
    if (!permitted(context) || TimerStateStore.load(context) != null) return false
    main.post {
      preview = true
      previewStartedAt = System.currentTimeMillis()
      show(context)
      main.removeCallbacks(previewEnd)
      main.postDelayed(previewEnd, PREVIEW_MS)
    }
    return true
  }

  private val previewEnd = Runnable {
    preview = false
    previewStartedAt = 0L
    removeWindow()
    application?.let(::emit)
  }

  fun attachService(service: ChandasCountdownService) {
    initialize(service)
    owner = service
    if (!screenReceiverRegistered) {
      service.registerReceiver(screenReceiver, IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_SCREEN_OFF)
      })
      screenReceiverRegistered = true
    }
    reconcile(service)
  }

  fun detachService(service: ChandasCountdownService) {
    if (owner !== service) return
    if (screenReceiverRegistered) {
      runCatching { service.unregisterReceiver(screenReceiver) }
      screenReceiverRegistered = false
    }
    owner = null
    main.post { if (!preview) removeWindow() }
  }

  fun reconcile(context: Context) {
    initialize(context)
    main.post {
      val shouldShow = screenInteractive(context) && (preview || (owner != null && requested(context) && permitted(context) &&
        TimerStateStore.load(context) != null && !foreground && !TimerStateStore.isAlarmVisible(context)))
      if (shouldShow) show(context) else removeWindow()
      emit(context)
    }
  }

  fun state(context: Context): Bundle {
    val shape = shape(context)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val edge = prefs.getString("$shape.edge", "right") ?: "right"
    val y = prefs.getFloat("$shape.y", 0.45f).coerceIn(0f, 1f)
    return bundleOf(
      "supported" to (Build.VERSION.SDK_INT >= 26),
      "requested" to requested(context),
      "permissionGranted" to permitted(context),
      "effective" to needsService(context),
      "visible" to visible,
      "expanded" to expanded,
      "preview" to preview,
      "appearance" to appearance(context),
      "edge" to edge,
      "verticalFraction" to y.toDouble(),
      "lastError" to lastError,
      "now" to System.currentTimeMillis(),
    )
  }

  private fun appearance(context: Context): String = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    .getString(APPEARANCE, "system")
    ?.takeIf { it == "system" || it == "dark" || it == "light" }
    ?: "system"

  fun setAppearance(context: Context, value: String) {
    if (value != "system" && value != "dark" && value != "light") return
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(APPEARANCE, value).apply()
    emit(context)
  }

  fun snapshot(context: Context): Bundle {
    val config = TimerStateStore.load(context)
    val controls = TimerStateStore.getControlState(context)
    if (config == null && preview) return bundleOf(
      "now" to System.currentTimeMillis(),
      "screenInteractive" to screenInteractive(context),
      "active" to true,
      "preview" to true,
      "expanded" to expanded,
      "cueAttention" to cueAttention,
      "cuePulse" to cuePulse,
      "timerV2Program" to """{"schemaVersion":3,"mode":"pattern","label":"Preview","labelIsCustom":true,"mainMinutes":15,"mainCue":{"sound":{"kind":"builtin","id":"temple-gong"},"volume":0.8},"completionCue":null,"subBellsEnabled":false,"tracks":[],"alignment":{"kind":"elapsed"},"runPolicy":{"kind":"continuous","cycleCount":1,"durationSeconds":900}}""",
      "timerV2Anchor" to previewStartedAt,
      "timerV2StartedAt" to previewStartedAt,
      "timerV2EndsAt" to 0L,
      "nextEventAt" to (previewStartedAt + 900_000L),
      "alarmOnceArmed" to false,
      "alarmModeEnabled" to false,
      "mutedUntil" to 0L,
      "mutedIterationsRemaining" to 0,
      "ringing" to false,
    )
    return bundleOf(
      "now" to System.currentTimeMillis(),
      "screenInteractive" to screenInteractive(context),
      "active" to (config != null),
      "preview" to false,
      "expanded" to expanded,
      "cueAttention" to cueAttention,
      "cuePulse" to cuePulse,
      "timerV2Program" to config?.timerV2Program,
      "timerV2Anchor" to (config?.timerV2Anchor ?: 0L),
      "timerV2StartedAt" to (config?.timerV2StartedAt ?: 0L),
      "timerV2EndsAt" to (config?.timerV2EndsAt ?: 0L),
      "timerV2RandomSeed" to (config?.timerV2RandomSeed ?: 0L),
      "timerV2PausedAt" to (config?.timerV2PausedAt ?: 0L),
      "nextEventAt" to TimerStateStore.nextAt(context),
      "nextLogicalId" to TimerStateStore.nextLogicalId(context),
      "alarmOnceArmed" to controls.alarmOnceArmed,
      "alarmModeEnabled" to (config?.alarmModeEnabled ?: false),
      "mutedUntil" to controls.mutedUntil,
      "mutedIterationsRemaining" to controls.mutedIterationsRemaining,
      "mutedIterationEndAt" to controls.mutedIterationEndAt,
      "mutedIterationEndId" to controls.mutedIterationEndId,
      "activeHoursEnabled" to (config?.activeHoursEnabled ?: false),
      "activeHoursStart" to (config?.activeHoursStart ?: 0),
      "activeHoursEnd" to (config?.activeHoursEnd ?: 0),
      "activeHoursDays" to (config?.activeHoursDays ?: 0),
      "availabilityPolicy" to config?.availabilityPolicy,
      "notificationPresentation" to config?.notificationPresentation,
      "compactText" to config?.let { TimerNotifications.compactStatus(it) },
      "volume" to (config?.volume ?: 0f),
      "ringing" to TimerStateStore.isAlarmVisible(context),
      "sessionGeneration" to TimerStateStore.sessionGeneration(context),
    )
  }

  fun emitSnapshot(context: Context) {
    val value = snapshot(context)
    snapshotListeners.notify(value)
    // The service-owned Fabric surface can outlive its Activity's event
    // emitter. Root props are a second, structural-only delivery path for
    // expansion and control changes; ordinary seconds never call this.
    main.post { (surface as? ReactSurfaceImpl)?.updateInitProps(value) }
  }
  private val snapshotListeners = NativeListenerRegistry<Bundle>()
  fun addSnapshotListener(listener: (Bundle) -> Unit) = snapshotListeners.add(listener)
  fun removeSnapshotListener(listener: (Bundle) -> Unit) = snapshotListeners.remove(listener)

  fun position(context: Context, edge: String, verticalFraction: Double) {
    if (edge != "left" && edge != "right" || !verticalFraction.isFinite()) return
    val shape = shape(context)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("$shape.edge", edge).putFloat("$shape.y", verticalFraction.toFloat().coerceIn(0f, 1f)).apply()
    main.post { updateBounds(context); emit(context) }
  }

  fun setExpanded(context: Context, value: Boolean) {
    main.post {
      if (visible) {
        if (expanded == value) return@post
        expanded = value
        cueAttention = false
        scheduleCollapse(context)
        emit(context)
        emitSnapshot(context)
      }
    }
  }

  /** Shows a short visual acknowledgement for an audible timer cue. */
  fun onCue(context: Context) {
    main.post {
      if (!visible || preview || foreground) return@post
      expanded = true
      cueAttention = true
      cuePulse++
      scheduleCollapse(context, CUE_EXPAND_MS)
      emit(context)
      emitSnapshot(context)
    }
  }

  fun interaction(context: Context) { main.post { scheduleCollapse(context) } }

  private fun scheduleCollapse(context: Context, delayMs: Long? = null) {
    main.removeCallbacks(collapseTask)
    if (!visible || !expanded) return
    val accessibility = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
    main.postDelayed(collapseTask, if (accessibility.isTouchExplorationEnabled) 15_000L else delayMs ?: 5_000L)
  }

  fun refreshBounds(context: Context) { main.post { updateBounds(context) } }

  /** React calls after committing the new compact/expanded content. */
  fun contentReady(context: Context) { main.post { if (visible) updateBounds(context) } }

  private fun shape(context: Context) = if (context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) "landscape" else "portrait"
  private fun dp(context: Context, value: Int) = (value * context.resources.displayMetrics.density).toInt()

  private fun updateBounds(context: Context) {
    val p = params ?: return
    val wm = window ?: return
    val view = windowView ?: return
    val screen = context.resources.displayMetrics
    val metrics = if (Build.VERSION.SDK_INT >= 30) wm.currentWindowMetrics else null
    val bounds = metrics?.bounds
    val insets = metrics?.windowInsets?.getInsetsIgnoringVisibility(
      WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
    val safeLeft = insets?.left ?: 0
    val safeTop = insets?.top ?: 0
    val safeRight = (bounds?.width() ?: screen.widthPixels) - (insets?.right ?: 0)
    val safeBottom = (bounds?.height() ?: screen.heightPixels) - (insets?.bottom ?: 0)
    val width = dp(context, if (expanded) 344 else COMPACT_WIDTH_DP).coerceAtMost((safeRight - safeLeft).coerceAtLeast(1))
    val height = dp(context, if (expanded) 470 else COMPACT_TOUCH_HEIGHT_DP).coerceAtMost((safeBottom - safeTop).coerceAtLeast(1))
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val shape = shape(context)
    val edge = prefs.getString("$shape.edge", "right")
    val y = prefs.getFloat("$shape.y", 0.45f).coerceIn(0f, 1f)
    p.width = width
    p.height = height
    p.x = if (edge == "left") safeLeft else (safeRight - width).coerceAtLeast(safeLeft)
    p.y = safeTop + (y * (safeBottom - safeTop - height).coerceAtLeast(0)).toInt()
    runCatching { wm.updateViewLayout(view, p) }.onFailure { lastError = "window-manager"; removeWindow() }
  }

  private fun show(context: Context) {
    if (visible || Build.VERSION.SDK_INT < 26 || !permitted(context) || System.currentTimeMillis() < retryAfter) return
    // A restored timer can start this service before the first Activity. In a
    // development client, creating the overlay's React context at that point
    // violates Expo Dev Launcher's Activity delegate initialization order and
    // crashes the app on its next launch. The Activity callback reconciles it.
    if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0 && !activityCreatedInProcess) return
    val host = (context.applicationContext as? ReactApplication)?.reactHost
    if (host == null) { lastError = "react-surface"; retryAfter = System.currentTimeMillis() + 30_000L; return }
    val initial = snapshot(context).apply { putBoolean("preview", preview) }
    val created = runCatching { host.createSurface(context.applicationContext, "ChandasFloatingTimer", initial) }.getOrNull()
    val view = created?.view
    if (created == null || view == null) { lastError = "react-surface"; retryAfter = System.currentTimeMillis() + 30_000L; return }
    val container = object : FrameLayout(context.applicationContext) {
      private val slop = ViewConfiguration.get(context).scaledTouchSlop
      private var downX = 0f
      private var downY = 0f
      private var originX = 0
      private var originY = 0
      private var dragging = false
      private var faceTouch = false
      private fun expandedWindow() = (params?.width ?: 0) > dp(context, 200)

      override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        if (!expandedWindow()) return true
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
          val cx = width / 2f
          val cy = dp(context, 176).toFloat()
          val radius = dp(context, 110).toFloat()
          val dx = event.x - cx
          val dy = event.y - cy
          faceTouch = dx * dx + dy * dy <= radius * radius
        }
        return faceTouch || super.onInterceptTouchEvent(event)
      }

      override fun onTouchEvent(event: MotionEvent): Boolean {
        if (expandedWindow() && !faceTouch) return super.onTouchEvent(event)
        when (event.actionMasked) {
          MotionEvent.ACTION_DOWN -> {
            main.removeCallbacks(collapseTask)
            downX = event.rawX; downY = event.rawY
            originX = params?.x ?: 0; originY = params?.y ?: 0
            dragging = false
            return true
          }
          MotionEvent.ACTION_MOVE -> {
            val dx = event.rawX - downX
            val dy = event.rawY - downY
            if (!dragging && dx * dx + dy * dy > slop * slop) dragging = true
            if (dragging) {
              params?.let { p ->
                p.x = originX + dx.toInt(); p.y = originY + dy.toInt()
                runCatching { window?.updateViewLayout(this, p) }
              }
            }
            return true
          }
          MotionEvent.ACTION_UP -> {
            if (dragging) {
              val p = params
              if (p != null) {
                val screen = context.resources.displayMetrics
                val edge = if (p.x + p.width / 2 < screen.widthPixels / 2) "left" else "right"
                val fraction = p.y.toDouble() / (screen.heightPixels - p.height).coerceAtLeast(1)
                position(context, edge, fraction)
              }
            } else if (!expandedWindow()) setExpanded(context, true)
            else if (cueAttention) setExpanded(context, false)
            else FloatingTimerActions.perform(context, "open-running")
            if (expandedWindow() && dragging) scheduleCollapse(context)
            return true
          }
          MotionEvent.ACTION_CANCEL -> { if (dragging) refreshBounds(context); scheduleCollapse(context); return true }
        }
        return true
      }
    }
    container.addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val p = WindowManager.LayoutParams(dp(context, COMPACT_WIDTH_DP), dp(context, COMPACT_TOUCH_HEIGHT_DP),
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP or Gravity.LEFT }
    val added = runCatching { wm.addView(container, p) }.isSuccess
    if (!added) {
      lastError = if (!permitted(context)) "permission" else "window-manager"
      retryAfter = System.currentTimeMillis() + 30_000L
      runCatching { created.stop() }; created.clear(); created.detach()
      return
    }
    window = wm; params = p; surface = created; windowView = container; visible = true; lastError = null
    updateBounds(context)
    // The Activity pauses the shared host before this background surface is
    // shown. Resume it without an Activity so Fabric can mount and update the
    // service-owned window; removeWindow balances this lifecycle when no
    // foreground Activity has taken ownership again.
    runCatching { host.onHostResume(null) }
      .onSuccess { overlayHostResumed = true }
      .onFailure { lastError = "react-surface"; retryAfter = System.currentTimeMillis() + 30_000L; removeWindow(); return }
    runCatching { created.start() }.onSuccess { task ->
      Thread {
        val finished = runCatching { task.waitForCompletion(10, java.util.concurrent.TimeUnit.SECONDS) }.getOrDefault(false)
        main.post {
          if (surface === created && (!finished || task.isFaulted() || task.isCancelled())) {
            lastError = "react-surface"
            retryAfter = System.currentTimeMillis() + 30_000L
            removeWindow()
            emit(context)
          }
        }
      }.start()
    }.onFailure { lastError = "react-surface"; retryAfter = System.currentTimeMillis() + 30_000L; removeWindow() }
    emit(context)
  }

  private fun removeWindow(preserveExpanded: Boolean = false) {
    if (!visible && surface == null) return
    main.removeCallbacks(collapseTask)
    val previous = surface
    val view: View? = windowView
    surface = null; windowView = null; visible = false
    if (!preserveExpanded) { expanded = false; cueAttention = false }
    params = null
    if (view != null) runCatching { window?.removeViewImmediate(view) }
    window = null
    if (previous != null) { runCatching { previous.stop() }; previous.clear(); previous.detach() }
    if (overlayHostResumed) {
      overlayHostResumed = false
      if (!foreground) {
        val host = (application as? ReactApplication)?.reactHost
        runCatching { host?.onHostPause() }
      }
    }
  }

  private fun emit(context: Context) {
    val result = state(context)
    val key = listOf(result.getBoolean("requested"), result.getBoolean("permissionGranted"),
      result.getBoolean("visible"), result.getBoolean("expanded"), result.getBoolean("preview"),
      result.getString("appearance"), lastError).joinToString(":")
    if (key != lastState) { lastState = key; listeners.notify(result) }
  }
}
