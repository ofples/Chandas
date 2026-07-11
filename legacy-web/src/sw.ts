/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { RangeRequestsPlugin } from 'workbox-range-requests'
import { nextTick, formatCountdown } from './lib/snapLogic'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

// Cache audio files at runtime on first request (CacheFirst).
// RangeRequestsPlugin is required so the browser's range requests
// (used when seeking/streaming audio) are served correctly from cache.
registerRoute(
  ({ request }) => request.destination === 'audio',
  new CacheFirst({
    cacheName: 'audio-v1',
    plugins: [new RangeRequestsPlugin()],
  })
)

const TAG = 'slottimer'

// Timer state owned by the SW.
// IMPORTANT: this is module-level and is lost whenever the SW is terminated
// by the browser. Every message handler that needs it must be prepared to
// receive it fresh from the client (see FIRE_NOTIFICATION handler below).
let timerMainMs = 0
let timerPhase  = 0
let minuteTimer: ReturnType<typeof setTimeout> | null = null
let gongTimer:   ReturnType<typeof setTimeout> | null = null

// ── Notification ──────────────────────────────────────────────

function showCountdown(renotify: boolean): Promise<void> {
  // Guard: if SW was restarted and state is lost, don't show NaN
  if (!timerMainMs) return Promise.resolve()
  const now      = Date.now()
  const nextMain = nextTick(now, timerMainMs, timerPhase)
  const time     = new Date(nextMain).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return self.registration.showNotification('SlotTimer', {
    tag:      TAG,
    body:     `Next gong at ${time}`,
    icon:     '/icon-192.png',
    badge:    '/icon-192.png',
    silent:   !renotify,
    renotify,
  })
}

// ── Scheduling ────────────────────────────────────────────────

// Schedules a notification at the exact moment the gong fires.
// This runs independently of the frontend so notifications fire even
// when the renderer is frozen on Android.
function scheduleGong() {
  if (gongTimer) { clearTimeout(gongTimer); gongTimer = null }
  if (!timerMainMs) return
  const delay = Math.max(0, nextTick(Date.now(), timerMainMs, timerPhase) - Date.now())
  gongTimer = setTimeout(() => {
    if (!timerMainMs) return
    showCountdown(true)
    scheduleGong()          // schedule next gong
    scheduleMinuteBoundary() // re-sync minute-boundary ticker
  }, delay)
}

// Schedules a silent countdown update at each minute boundary so the
// notification body stays current when the user glances at the shade.
function scheduleMinuteBoundary() {
  if (minuteTimer) { clearTimeout(minuteTimer); minuteTimer = null }
  if (!timerMainMs) return
  const remaining    = nextTick(Date.now(), timerMainMs, timerPhase) - Date.now()
  const msIntoMinute = remaining % 60_000
  const delay        = msIntoMinute === 0 ? 60_000 : msIntoMinute
  minuteTimer = setTimeout(() => {
    if (!timerMainMs) return
    showCountdown(false)
    scheduleMinuteBoundary()
  }, delay)
}

function clearTimers() {
  if (minuteTimer) { clearTimeout(minuteTimer); minuteTimer = null }
  if (gongTimer)   { clearTimeout(gongTimer);   gongTimer   = null }
}

// ── Message handling ──────────────────────────────────────────

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as {
    type: string
    mainMs?: number
    phase?: number
  }
  if (!data?.type) return

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }

  if (data.type === 'CLEAR_NOTIFICATION') {
    timerMainMs = 0
    timerPhase  = 0
    clearTimers()
    event.waitUntil(
      self.registration.getNotifications({ tag: TAG }).then(notifs =>
        Promise.all(notifs.map(n => { n.close(); return Promise.resolve() }))
      )
    )
    return
  }

  if (data.type === 'START_TIMER') {
    timerMainMs = data.mainMs!
    timerPhase  = data.phase!
    clearTimers()
    scheduleGong()
    scheduleMinuteBoundary()
    event.waitUntil(showCountdown(false))
    return
  }

  if (data.type === 'FIRE_NOTIFICATION') {
    // The frontend fired a bell. It also passes its state so we can
    // self-heal if the SW was terminated and lost timerMainMs/timerPhase.
    if (data.mainMs && !timerMainMs) {
      timerMainMs = data.mainMs
      timerPhase  = data.phase ?? 0
      scheduleGong()
      scheduleMinuteBoundary()
    }
    event.waitUntil(showCountdown(true))
  }
})

// ── Notification click ────────────────────────────────────────

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        const focused = clients.find(c => c.focused)
        if (focused) return focused.focus()
        if (clients.length > 0) return clients[0].focus()
        return self.clients.openWindow('/')
      })
  )
})
