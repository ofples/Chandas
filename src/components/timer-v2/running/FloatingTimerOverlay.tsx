import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ThemeProvider, useTheme } from '../../../theme/ThemeContext'
import { AlarmIcon, ClockIcon, RestartIcon, TimerTransportIcon, VolumeIcon } from '../../Icons'
import { TimerControlButton } from './TimerControlButton'
import { TimerWatchface, type TimerWatchfaceModel } from './TimerWatchface'
import { ChandasTimerService, type NativeFloatingOverlaySnapshot, type NativeTimerState } from '../../../native/ChandasTimerService'
import { defaultTimerHapticsSettings } from '../../../lib/haptic-profiles'
import { formatCompactDurationSeconds, normalizeAvailabilityPolicy, parseTimerProgram, sequenceStepDurationSeconds } from '../../../lib/timerV2'
import { timerV2DisplayFor } from '../../../hooks/useTimerV2'
import { formatCountdown } from '../../../lib/snapLogic'
import { subBellColorValue } from '../../../lib/subBellColors'
import type { AppTimerSettings, RuntimeTimerProgram } from '../../../types'
import { parseUnifiedTimerProgram } from '../../../lib/unified-timer'
import { hasFollowingStep, programCycleDurationMs } from '../../../lib/timeline'
import type { RuntimeMuteState } from '../../../lib/runtimeV2'

const FALLBACK_SETTINGS: AppTimerSettings = {
  masterVolume: 0.8, advancedModeEnabled: false, secondPrecisionEnabled: false,
  alarmSound: { kind: 'builtin', id: 'alarm-tone' }, alarmVolume: 1,
  haptics: defaultTimerHapticsSettings(), notificationsEnabled: true,
  liveCountdownEnabled: false, muteDuringCallsEnabled: true,
  availability: { enabled: false, weeklyWindows: [], overrides: [] },
  focusAutomationEnabled: false, alarmDurationSeconds: 60,
}

function settingsFromSnapshot(snapshot: NativeTimerState): AppTimerSettings {
  let availability = FALLBACK_SETTINGS.availability
  if (snapshot.availabilityPolicy) {
    try { availability = normalizeAvailabilityPolicy(JSON.parse(snapshot.availabilityPolicy)) } catch { /* safe fallback */ }
  }
  return { ...FALLBACK_SETTINGS, masterVolume: snapshot.volume ?? FALLBACK_SETTINGS.masterVolume, notificationsEnabled: snapshot.notificationsEnabled ?? true, liveCountdownEnabled: snapshot.liveCountdownEnabled ?? false, muteDuringCallsEnabled: snapshot.muteDuringCallsEnabled ?? true, availability }
}

function muteFromSnapshot(snapshot: NativeTimerState): RuntimeMuteState {
  return { mutedUntil: snapshot.mutedUntil ?? 0, ...(snapshot.mutedIterationEndId && snapshot.mutedIterationEndAt ? { iteration: { endsAtLogicalId: snapshot.mutedIterationEndId, endsAt: snapshot.mutedIterationEndAt, iterations: snapshot.mutedIterationsRemaining ?? 1 } } : {}) }
}

function useOverlaySnapshot(incoming: NativeFloatingOverlaySnapshot): NativeFloatingOverlaySnapshot {
  const [snapshot, setSnapshot] = useState<NativeFloatingOverlaySnapshot>(() => ({ ...ChandasTimerService.getFloatingOverlaySnapshot(), ...incoming, now: Date.now(), expanded: incoming.expanded ?? ChandasTimerService.getFloatingOverlayState().expanded }))
  useEffect(() => { setSnapshot(current => ({ ...current, ...incoming })) }, [incoming])
  useEffect(() => {
    const snapshots = ChandasTimerService.addFloatingOverlaySnapshotListener(next => setSnapshot(current => ({ ...current, ...next, expanded: next.expanded ?? current.expanded })))
    const states = ChandasTimerService.addFloatingOverlayStateListener(state => setSnapshot(current => ({ ...current, expanded: state.expanded, now: Date.now() })))
    return () => { snapshots?.remove(); states?.remove() }
  }, [])
  useEffect(() => {
    // The overlay owns a display clock only while it can actually be seen.
    // Preview retains its seeded program without querying an absent session.
    if (!snapshot.active || snapshot.timerV2PausedAt || snapshot.screenInteractive === false) return
    let tick: ReturnType<typeof setTimeout>
    const refresh = () => {
      setSnapshot(current => {
        const now = Date.now()
        return Math.floor(now / 1_000) === Math.floor(current.now / 1_000) ? current : { ...current, now }
      })
      tick = setTimeout(refresh, 1_000 - (Date.now() % 1_000) + 12)
    }
    tick = setTimeout(refresh, 1_000 - (Date.now() % 1_000) + 12)
    return () => clearTimeout(tick)
  }, [snapshot.active, snapshot.timerV2PausedAt, snapshot.screenInteractive])
  return snapshot
}

function compactCycleEnd(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`
}

function collapsedText(program: RuntimeTimerProgram, display: ReturnType<typeof timerV2DisplayFor>, anchor: number, now: number): string {
  if (display.activeHoursPaused) {
    if (!display.activeHoursResumeAt) return 'Quiet'
    const date = new Date(display.activeHoursResumeAt)
    return `Quiet • ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  if (program.mode === 'sequence' || (program.mode === 'unified' && program.steps.length > 1)) {
    const step = program.steps[display.position?.currentStepIndex ?? 0]
    return step ? `${display.mainCountdown} • ${step.label.slice(0, 4)}` : display.mainCountdown
  }
  const next = display.position?.nextEvent
  const cycleEndsAt = anchor + ((display.position?.cycleIndex ?? 0) + 1) * programCycleDurationMs(program)
  const lastBell = !next || next.boundary === 'pattern-main' || Math.abs(next.at - cycleEndsAt) < 1_000
  return lastBell ? display.mainCountdown : `${display.nextCueCountdown} • ${compactCycleEnd(cycleEndsAt - now)}`
}

function Content({ incoming }: { incoming: NativeFloatingOverlaySnapshot }) {
  const { tokens, theme } = useTheme()
  const snapshot = useOverlaySnapshot(incoming)
  useEffect(() => { ChandasTimerService.floatingOverlayAction('overlay-layout-ready') }, [snapshot.expanded])
  const [stopArmed, setStopArmed] = useState(false)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alarmTap = useRef<ReturnType<typeof setTimeout> | null>(null)
  const program = useMemo(() => {
    if (!snapshot.timerV2Program) return null
    try {
      const raw = JSON.parse(snapshot.timerV2Program) as unknown
      if (raw && typeof raw === 'object' && 'schemaVersion' in raw && raw.schemaVersion === 4) {
        const parsed = parseUnifiedTimerProgram(raw)
        return parsed.ok ? parsed.value : null
      }
      return parseTimerProgram(raw)
    } catch { return null }
  }, [snapshot.timerV2Program])
  const settings = useMemo(() => settingsFromSnapshot(snapshot), [snapshot.volume, snapshot.notificationsEnabled, snapshot.liveCountdownEnabled, snapshot.muteDuringCallsEnabled, snapshot.availabilityPolicy])
  const mute = useMemo(() => muteFromSnapshot(snapshot), [snapshot.mutedUntil, snapshot.mutedIterationEndId, snapshot.mutedIterationEndAt, snapshot.mutedIterationsRemaining])
  const effectiveNow = snapshot.timerV2PausedAt && snapshot.timerV2PausedAt > 0 ? snapshot.timerV2PausedAt : snapshot.now
  const display = useMemo(() => program ? timerV2DisplayFor(program, settings, mute, snapshot.timerV2Anchor ?? effectiveNow, snapshot.timerV2StartedAt ?? effectiveNow, snapshot.timerV2EndsAt && snapshot.timerV2EndsAt > 0 ? snapshot.timerV2EndsAt : null, effectiveNow, snapshot.timerV2RandomSeed || snapshot.timerV2Anchor || effectiveNow) : null, [mute, program, settings, effectiveNow, snapshot.timerV2Anchor, snapshot.timerV2EndsAt, snapshot.timerV2StartedAt, snapshot.timerV2RandomSeed])
  useEffect(() => () => { if (stopTimer.current) clearTimeout(stopTimer.current); if (alarmTap.current) clearTimeout(alarmTap.current) }, [])
  if (!program || !display || !snapshot.active) return <View style={styles.empty} />
  const collapsed = snapshot.timerV2PausedAt ? `Paused • ${display.nextCueCountdown}` : collapsedText(program, display, snapshot.timerV2Anchor ?? snapshot.now, snapshot.now)
  if (!snapshot.expanded) return <View style={styles.compactTarget}><Pressable onPress={() => ChandasTimerService.floatingOverlayAction('expand')} style={({ pressed }) => [styles.pill, { backgroundColor: tokens.surface, borderColor: tokens.border, opacity: pressed && theme !== 'eink' ? 0.76 : 1 }]} accessibilityRole="button" accessibilityLabel={`${collapsed}. Expand floating timer.`}><Text numberOfLines={1} style={[styles.pillText, { color: tokens.text }]}>{collapsed}</Text></Pressable></View>

  const multiStep = program.mode === 'sequence' || (program.mode === 'unified' && program.steps.length > 1)
  const oneStepUnified = program.mode === 'unified' && program.steps.length === 1
  const sequenceIndex = multiStep ? display.position?.currentStepIndex ?? 0 : 0
  const currentStep = multiStep ? program.steps[sequenceIndex] : null
  const followsStep = hasFollowingStep(program, display.position, display.runEndsAt)
  const nextStep = multiStep && followsStep ? program.steps[(sequenceIndex + 1) % program.steps.length] : null
  const nextStepSeconds = nextStep ? (program.mode === 'unified'
    ? program.steps[(sequenceIndex + 1) % program.steps.length].durationSeconds
    : program.mode === 'sequence' ? sequenceStepDurationSeconds(program.steps[(sequenceIndex + 1) % program.steps.length]) : 0) : 0
  const currentStepAlarmEnabled = program.mode === 'unified'
    ? program.steps[sequenceIndex]?.endAlarmEnabled === true
    : program.mode === 'sequence' && program.steps[sequenceIndex]?.alarmEnabled === true
  const runtimeMuted = mute.mutedUntil > snapshot.now || Boolean(mute.iteration)
  const nextCueColor = program.mode === 'pattern'
    ? subBellColorValue(program.tracks.find(track => track.id === display.position?.nextEvent?.winner.cueId)?.color, Math.max(0, program.tracks.findIndex(track => track.id === display.position?.nextEvent?.winner.cueId)), theme === 'eink')
    : program.mode === 'unified'
      ? subBellColorValue(program.steps[sequenceIndex]?.subBellTracks.find(track => track.id === (program.mode === 'unified' ? display.position?.nextEvent?.winner.trackId : display.position?.nextEvent?.winner.cueId))?.color, Math.max(0, (program.steps[sequenceIndex]?.subBellTracks ?? []).findIndex(track => track.id === (program.mode === 'unified' ? display.position?.nextEvent?.winner.trackId : display.position?.nextEvent?.winner.cueId))), theme === 'eink')
      : tokens.accent
  const model: TimerWatchfaceModel = {
    mainLabel: display.mainCountdown,
    mainCaption: snapshot.timerV2PausedAt ? 'Paused' : display.activeHoursPaused ? 'Schedule is quiet' : multiStep ? `step ${sequenceIndex + 1} of ${program.steps.length}` : undefined,
    nextLabel: nextStep ? 'NEXT' : undefined,
    nextName: nextStep ? `${nextStep.label} · ${formatCompactDurationSeconds(nextStepSeconds)}` : (program.mode === 'pattern' || oneStepUnified) && display.position?.nextEvent?.boundary !== 'pattern-main' ? display.nextCueLabel : undefined,
    nextTime: (program.mode === 'pattern' || oneStepUnified) && display.position?.nextEvent?.boundary !== 'pattern-main' ? display.nextCueCountdown : undefined,
    nextColor: nextCueColor, muted: runtimeMuted || settings.masterVolume <= 0, runtimeMuted,
  }
  const action = (name: string) => ChandasTimerService.floatingOverlayAction(name)
  const alarmPress = () => {
    if (alarmTap.current) { clearTimeout(alarmTap.current); alarmTap.current = null; action('alarm-double'); return }
    alarmTap.current = setTimeout(() => { alarmTap.current = null; action('alarm-single') }, 230)
  }
  const stop = () => {
    if (!stopArmed) { setStopArmed(true); stopTimer.current = setTimeout(() => setStopArmed(false), 3_000); return }
    action('stop')
  }
  const controlProps = { size: 48, filled: true }
  return <View style={styles.expanded}>
    {multiStep ? <View style={styles.previousControl}><TimerControlButton {...controlProps} label="Previous step" tooltip="Skip to previous step" disabled={snapshot.preview || (sequenceIndex === 0 && display.position?.cycleIndex === 0 && display.runEndsAt > 0)} onPress={() => action('previous-step')}><TimerTransportIcon kind="previous" color={tokens.accent} /></TimerControlButton></View> : null}
    <View style={styles.pauseControl}><TimerControlButton {...controlProps} label={snapshot.timerV2PausedAt ? 'Resume timer' : 'Pause timer'} tooltip={snapshot.timerV2PausedAt ? 'Resume timer' : 'Pause timer'} disabled={snapshot.preview} active={!!snapshot.timerV2PausedAt} onPress={() => action(snapshot.timerV2PausedAt ? 'resume' : 'pause')}><TimerTransportIcon kind={snapshot.timerV2PausedAt ? 'play' : 'pause'} color={tokens.accent} /></TimerControlButton></View>
    {multiStep ? <View style={styles.nextControl}><TimerControlButton {...controlProps} label={!followsStep ? 'Finish run' : 'Next step'} tooltip="Skip to next step" disabled={snapshot.preview} onPress={() => action('next-step')}><TimerTransportIcon kind="next" color={tokens.accent} /></TimerControlButton></View> : null}
    <View style={[styles.faceShell, { backgroundColor: tokens.bg }, theme === 'eink' && styles.einkFaceShell]}><TimerWatchface program={program} position={display.position} progress={display.progress} eventPulse={snapshot.cuePulse ?? 0} flashOnMount={snapshot.cueAttention} size={220} model={model} presentation="floating-overlay" onPress={() => action(snapshot.cueAttention ? 'collapse' : 'open-running')} accessibilityLabel={snapshot.cueAttention ? 'Dismiss timer cue' : 'Open running timer'} /></View>
    <View style={styles.resetControl}><TimerControlButton {...controlProps} label="Reset interval" tooltip="Reset interval" disabled={snapshot.preview} onPress={() => action('restart')}><RestartIcon color={tokens.accent} /></TimerControlButton></View>
    <View style={styles.clockControl}><TimerControlButton {...controlProps} label="Clock alignment" tooltip="Toggle clock alignment" disabled={snapshot.preview} active={program.alignment.kind === 'local-clock'} onPress={() => action('toggle-clock')} onLongPress={() => action('open-clock')}><ClockIcon color={tokens.accent} /></TimerControlButton></View>
    {program.mode === 'pattern' || oneStepUnified ? <View style={styles.alarmControl}><TimerControlButton {...controlProps} label="Alarm" tooltip="Tap for next interval, double tap to lock" disabled={snapshot.preview} active={snapshot.alarmOnceArmed || snapshot.alarmModeEnabled} onPress={alarmPress}><AlarmIcon color={snapshot.alarmOnceArmed || snapshot.alarmModeEnabled ? tokens.accent : tokens.textMuted} /></TimerControlButton></View> : currentStep ? <View style={styles.alarmControl}><TimerControlButton {...controlProps} label={`${currentStepAlarmEnabled ? 'Turn off' : 'Turn on'} alarm for ${currentStep.label}`} tooltip="Toggle alarm at this step's end" disabled={snapshot.preview} active={currentStepAlarmEnabled} onPress={() => action(`toggle-step-alarm:${currentStep.id}`)}><AlarmIcon color={currentStepAlarmEnabled ? tokens.accent : tokens.textMuted} /></TimerControlButton></View> : null}
    <View style={styles.soundControl}><TimerControlButton {...controlProps} label="Sound and mute" tooltip="Mute one interval" disabled={snapshot.preview} active={runtimeMuted || settings.masterVolume <= 0} onPress={() => action(runtimeMuted ? 'clear-mute' : 'mute')} onLongPress={() => action('open-sound')}><VolumeIcon muted={runtimeMuted || settings.masterVolume <= 0} color={runtimeMuted ? tokens.accent : tokens.textMuted} /></TimerControlButton></View>
    <View style={styles.stopControl}><TimerControlButton {...controlProps} label={stopArmed ? 'Tap again to stop' : 'Stop timer'} tooltip={stopArmed ? 'Tap again to stop' : 'Stop timer'} disabled={snapshot.preview} active={stopArmed} onPress={stop}><Text style={[styles.stopGlyph, { color: stopArmed ? tokens.warm : tokens.textMuted }]}>■</Text></TimerControlButton></View>
    {snapshot.preview ? <Text style={[styles.ends, { color: tokens.textMuted }]}>Preview</Text> : display.runEndsAt > 0 ? <Text style={[styles.ends, { color: tokens.textMuted }]}>Ends in {formatCountdown(display.runRemainingMs)}</Text> : null}
  </View>
}

export function FloatingTimerOverlay(incoming: NativeFloatingOverlaySnapshot) {
  const [appearance, setAppearance] = useState<'system' | 'dark' | 'light'>(() => ChandasTimerService.getFloatingOverlayState().appearance ?? 'system')
  useEffect(() => {
    const subscription = ChandasTimerService.addFloatingOverlayStateListener(state => setAppearance(state.appearance ?? 'system'))
    return () => subscription?.remove()
  }, [])
  return <View style={styles.root}><ThemeProvider themeOverride={appearance}><Content incoming={incoming} /></ThemeProvider></View>
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' }, empty: { flex: 1, backgroundColor: 'transparent' },
  compactTarget: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pill: { width: 124, height: 40, borderWidth: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  pillText: { fontFamily: 'JetBrainsMono-Regular', fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '700' },
  expanded: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 66 },
  faceShell: { width: 220, height: 220, borderRadius: 110, alignItems: 'center', justifyContent: 'center', elevation: 8, zIndex: 1 },
  einkFaceShell: { elevation: 0 },
  // Control centers share a 150dp orbit around the 228dp face: a single,
  // readable lower arc rather than five individually placed buttons.
  previousControl: { position: 'absolute', left: 18, top: 58, zIndex: 2 },
  pauseControl: { position: 'absolute', left: 148, top: 0, zIndex: 2 },
  nextControl: { position: 'absolute', left: 278, top: 58, zIndex: 2 },
  resetControl: { position: 'absolute', left: 18, top: 227, zIndex: 2 },
  clockControl: { position: 'absolute', left: 73, top: 282, zIndex: 2 },
  alarmControl: { position: 'absolute', left: 148, top: 302, zIndex: 2 },
  soundControl: { position: 'absolute', left: 223, top: 282, zIndex: 2 },
  stopControl: { position: 'absolute', left: 278, top: 227, zIndex: 2 },
  stopGlyph: { fontSize: 13, lineHeight: 15 }, ends: { position: 'absolute', top: 406, alignSelf: 'center', fontSize: 11, fontVariant: ['tabular-nums'] },
})
