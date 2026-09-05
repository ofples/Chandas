import * as Haptics from 'expo-haptics'
import type { NativeTimerEvent } from '../native/ChandasTimerService'

/** Fire-and-forget haptics. Every call is safe on devices without a vibrator. */
export function tapHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
}

export function selectionHaptic(): void {
  void Haptics.selectionAsync().catch(() => undefined)
}

export function timerCueHaptic(boundary: NativeTimerEvent['boundary']): void {
  const strong = boundary === 'pattern-main' || boundary === 'sequence-cycle' || boundary === 'run-complete'
  void Haptics.impactAsync(strong ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
}
