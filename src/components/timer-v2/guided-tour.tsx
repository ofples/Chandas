import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BackHandler, Keyboard, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../theme/ThemeContext'

export type TourStep = 'new' | 'duration' | 'bells' | 'add-bell' | 'repeat' | 'start' | 'controls' | 'stop' | 'save' | 'gallery' | 'library'
const ORDER: TourStep[] = ['new', 'duration', 'bells', 'add-bell', 'repeat', 'start', 'controls', 'stop', 'save', 'gallery', 'library']
const LESSONS: Record<TourStep, { target: string; stage: string; title: string; body: string; action?: boolean }> = {
  new: { target: 'tour-new', stage: 'Create', title: 'Make a timer', body: 'Tap + to open a setup. Your other timers and drafts stay saved.', action: true },
  duration: { target: 'tour-duration', stage: 'Create', title: 'Choose a duration', body: 'Choose how long it runs. You can also tap the title to give it a name.' },
  bells: { target: 'tour-bells', stage: 'Bells', title: 'Add a repeating bell', body: 'Open Sub-bells to add a sound during the interval.', action: true },
  'add-bell': { target: 'tour-add-bell', stage: 'Bells', title: 'Add a sub-bell', body: 'Tap here to add a bell during this interval.', action: true },
  repeat: { target: 'tour-repeat', stage: 'Bells', title: 'Choose how often', body: 'Choose a gap for Repeat. Random varies the gaps; Points places bells at chosen percentages or times.' },
  start: { target: 'tour-start', stage: 'Run', title: 'Start your timer', body: 'This starts your actual timer, with the sounds you selected.', action: true },
  controls: { target: 'tour-controls', stage: 'Run', title: 'Pause and resume', body: 'This keeps your place. The lower controls reset, align to clock, and mute; hold an icon to see what it does.' },
  stop: { target: 'tour-stop', stage: 'Run', title: 'Return to setup', body: 'Tap Stop when you’re ready. Your setup stays here, ready to save.', action: true },
  save: { target: 'tour-save', stage: 'Save', title: 'Save your timer', body: 'Tap Save to keep this configuration. Later edits update the same timer. Unsaved edits are kept as a draft.', action: true },
  gallery: { target: 'tour-gallery', stage: 'Configurations', title: 'Find your timers', body: 'This opens Configurations, from setup or the running screen.', action: true },
  library: { target: 'tour-library', stage: 'Configurations', title: 'Ready to use', body: 'Tap a card to edit it or return to its running screen. Play starts a timer here. You can replay this tour from Settings.' },
}
type RegisteredTarget = { scope: string; node: View }
type TourContextValue = {
  step: TourStep | null; suspended: boolean; start: (step: TourStep, finish: (completed: boolean) => void) => void;
  advance: (expected: TourStep) => void; go: (step: TourStep) => void; dismiss: (completed: boolean) => void;
  suspend: (value: boolean) => void; targets: React.RefObject<Map<string, RegisteredTarget[]>>;
}
const TourContext = createContext<TourContextValue | null>(null)
const Scope = createContext({ id: 'root', active: true })
export function GuidedTourProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<TourStep | null>(null)
  const [suspended, suspend] = useState(false)
  const targets = useRef(new Map<string, RegisteredTarget[]>())
  const finish = useRef<(completed: boolean) => void>(() => {})
  const start = useCallback((next: TourStep, onFinish: (completed: boolean) => void) => { finish.current = onFinish; setStep(next) }, [])
  const advance = useCallback((expected: TourStep) => setStep(current => current === expected ? ORDER[ORDER.indexOf(current) + 1] ?? current : current), [])
  const go = useCallback((next: TourStep) => setStep(next), [])
  const dismiss = useCallback((completed: boolean) => { setStep(null); finish.current(completed) }, [])
  useEffect(() => {
    if (!step || suspended) return
    const back = BackHandler.addEventListener('hardwareBackPress', () => { dismiss(false); return true })
    return () => back.remove()
  }, [step, suspended, dismiss])
  const value = useMemo(() => ({ step, suspended, start, advance, go, dismiss, suspend, targets }), [step, suspended, start, advance, go, dismiss])
  return <TourContext value={value}>{children}</TourContext>
}
export function useGuidedTour() { return use(TourContext) }
export function TourSurface({ id, active, children }: { id: string; active: boolean; children: ReactNode }) {
  return <Scope value={useMemo(() => ({ id, active }), [id, active])}>{children}</Scope>
}
export function TourTarget({ id, children, style }: { id: string; children: ReactNode; style?: React.ComponentProps<typeof View>['style'] }) {
  const tour = useGuidedTour(), scope = use(Scope), node = useRef<View>(null)
  useEffect(() => {
    if (!tour || !scope.active || !node.current) return
    const target = { scope: scope.id, node: node.current }
    const map = tour.targets.current
    map.set(id, [...(map.get(id) ?? []), target])
    return () => { const remaining = (map.get(id) ?? []).filter(t => t !== target); if (remaining.length) map.set(id, remaining); else map.delete(id) }
  }, [id, scope.id, scope.active, tour?.targets])
  return <View ref={node} collapsable={false} style={style}>{children}</View>
}

/** Lives in the same native window as its target, leaving the real controls touchable. */
export function GuidedTourOverlay({ scope = 'root' }: { scope?: string }) {
  const tour = useGuidedTour(), { tokens } = useTheme(), insets = useSafeAreaInsets(), { width, height } = useWindowDimensions()
  const host = useRef<View>(null)
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [showFallback, setShowFallback] = useState(false)
  const [cardHeight, setCardHeight] = useState(210)
  const [keyboardTop, setKeyboardTop] = useState(height)
  const lesson = tour?.step ? LESSONS[tour.step] : null
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setKeyboardTop(e.endCoordinates.screenY))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(height))
    return () => { show.remove(); hide.remove() }
  }, [height])
  useEffect(() => {
    setRect(null); setShowFallback(false)
    if (!tour?.step || tour.suspended || !lesson) return
    const measure = () => {
      const entries = tour.targets.current.get(lesson.target) ?? []
      const target = [...entries].reverse().find(t => t.scope !== 'root') ?? entries.at(-1)
      if (!target || target.scope !== scope) { setRect(null); setShowFallback(!target && scope === 'root'); return }
      setShowFallback(false)
      host.current?.measureInWindow((hx, hy) => target.node.measureInWindow((x, y, w, h) => {
        if (w <= 0 || h <= 0) { setRect(null); return }
        const next = { x: Math.max(4, x - hx - 5), y: Math.max(insets.top, y - hy - 5), width: Math.min(width - 8, w + 10), height: Math.min(height - insets.top - insets.bottom, h + 10) }
        setRect(old => old && Math.abs(old.x - next.x) < 1 && Math.abs(old.y - next.y) < 1 && Math.abs(old.width - next.width) < 1 && Math.abs(old.height - next.height) < 1 ? old : next)
      }))
    }
    const timer = setInterval(measure, 160); measure()
    return () => clearInterval(timer)
  }, [tour?.step, tour?.suspended, lesson, scope, width, height, insets.top, insets.bottom])
  if (!tour?.step || tour.suspended || !lesson) return null
  const bottom = Math.min(height - insets.bottom - 12, keyboardTop - 12)
  const top = rect && rect.y + rect.height + 12 + cardHeight <= bottom ? rect.y + rect.height + 12 : rect ? Math.max(insets.top + 12, rect.y - cardHeight - 12) : Math.max(insets.top + 12, bottom - cardHeight)
  return <View ref={host} pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
    {rect ? <>
      <View pointerEvents="none" style={[styles.shade, { left: 0, right: 0, top: 0, height: rect.y }]} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, right: 0, top: rect.y + rect.height, bottom: 0 }]} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: rect.y, width: rect.x, height: rect.height }]} />
      <View pointerEvents="none" style={[styles.shade, { left: rect.x + rect.width, right: 0, top: rect.y, height: rect.height }]} />
      <View pointerEvents="none" style={[styles.highlight, { left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderColor: tokens.accent }]} />
      <View testID="guided-tour-hint" accessibilityLiveRegion="polite" onLayout={e => setCardHeight(e.nativeEvent.layout.height)} style={[styles.card, { left: 16, right: 16, top, backgroundColor: tokens.surfaceHi, borderColor: tokens.border }]}>
        <Text style={[styles.stage, { color: tokens.accent }]}>{lesson.stage}</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: tokens.text }]}>{lesson.title}</Text>
        <Text style={[styles.body, { color: tokens.text }]}>{lesson.body}</Text>
        <View style={styles.buttons}>
          <Pressable accessibilityRole="button" accessibilityLabel="Skip tour" onPress={() => tour.dismiss(false)} style={styles.skip}><Text style={[styles.body, { color: tokens.textMuted }]}>Skip</Text></Pressable>
          {!lesson.action ? <Pressable accessibilityRole="button" accessibilityLabel={tour.step === 'library' ? 'Finish tour' : 'Next tip'} onPress={() => { Keyboard.dismiss(); if (tour.step === 'library') tour.dismiss(true); else tour.advance(tour.step!) }} style={[styles.next, { backgroundColor: tokens.accent }]}><Text style={[styles.body, { color: '#fff' }]}>{tour.step === 'library' ? 'Done' : 'Next'}</Text></Pressable> : <Text style={[styles.stage, { color: tokens.textMuted }]}>Try the highlighted control</Text>}
        </View>
      </View>
    </> : showFallback ? <Pressable accessibilityRole="button" accessibilityLabel="Skip tour" onPress={() => tour.dismiss(false)} style={[styles.fallback, { top: insets.top + 12, backgroundColor: tokens.surfaceHi, borderColor: tokens.border }]}><Text style={[styles.body, { color: tokens.text }]}>Skip tour</Text></Pressable> : null}
  </View>
}
const styles = StyleSheet.create({ fallback: { position: 'absolute', right: 16, minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, justifyContent: 'center' }, shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.5)' }, highlight: { position: 'absolute', borderWidth: 2, borderRadius: 15 }, card: { position: 'absolute', borderWidth: 1, borderRadius: 18, padding: 16, gap: 8, elevation: 16, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 14 }, stage: { fontSize: 12, lineHeight: 18 }, title: { fontSize: 19, fontWeight: '500' }, body: { fontSize: 15, lineHeight: 21 }, buttons: { marginTop: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, skip: { minHeight: 44, paddingHorizontal: 6, justifyContent: 'center' }, next: { minHeight: 44, borderRadius: 22, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' } })
