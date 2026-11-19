import { useRef, useState } from 'react'
import { PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Slider from '@react-native-community/slider'
import type { BellPoint } from '../../types'
import { bellPointSeconds } from '../../lib/bell-points'
import { createProgramId, formatCompactDurationSeconds } from '../../lib/timerV2'
import { useTheme } from '../../theme/ThemeContext'
import { selectionHaptic } from '../../lib/haptics'
import { DraggableSheet } from './DraggableSheet'
import { CustomMinutePicker } from '../CustomMinutePicker'
import { Chip } from '../Chip'

const pointName = (point: BellPoint) => point.kind === 'percent' ? `At ${point.value}%` : `${formatCompactDurationSeconds(point.value)} ${point.kind === 'end' ? 'before end' : 'after start'}`

/** The authored values stay intact; only their resolved, audible positions move with duration. */
export function BellPointsEditor({ points, durationSeconds, secondPrecision, color, onChange }: {
  points: BellPoint[]; durationSeconds: number; secondPrecision: boolean; color: string; onChange: (points: BellPoint[]) => void
}) {
  const { tokens } = useTheme()
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<BellPoint[] | null>(null)
  const previewRef = useRef<BellPoint[] | null>(null)
  const [axisWidth, setAxisWidth] = useState(1)
  const [editing, setEditing] = useState<BellPoint | null>(null)
  const [percent, setPercent] = useState('50')
  const [timeOpen, setTimeOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = preview ?? points
  const sorted = [...current].sort((a, b) => bellPointSeconds(a, durationSeconds) - bellPointSeconds(b, durationSeconds))
  const fits = (point: BellPoint) => { const at = bellPointSeconds(point, durationSeconds); return at > 0 && at < durationSeconds }
  const open = (point?: BellPoint) => {
    const occupied = points.filter(p => p.kind === 'percent').map(p => p.value)
    const next = [50, 25, 75, 10, 90, 33, 67].find(value => !occupied.includes(value)) ?? 1
    const value = point ?? { id: createProgramId(), kind: 'percent' as const, value: next }
    setSelected(value.id); setEditing({ ...value }); setPercent(String(value.kind === 'percent' ? value.value : Math.round(bellPointSeconds(value, durationSeconds) / durationSeconds * 1000) / 10)); setError(null)
  }
  const commit = () => {
    if (!editing) return
    const next = editing.kind === 'percent' ? { ...editing, value: Number(percent) } : editing
    if (next.kind === 'percent' && (!percent.trim() || !Number.isFinite(next.value) || next.value < 0.1 || next.value > 99.9 || Math.abs(next.value * 10 - Math.round(next.value * 10)) > 0.000001)) { setError('Choose 0.1% to 99.9%, with at most one decimal.'); return }
    if (points.some(p => p.id !== next.id && p.kind === next.kind && p.value === next.value)) { setError('This point is already included.'); return }
    onChange([...points.filter(p => p.id !== next.id), next]); setEditing(null)
  }
  const handleGroups = new Map<number, BellPoint[]>()
  for (const point of sorted.filter(fits)) {
    const at = bellPointSeconds(point, durationSeconds)
    handleGroups.set(at, [...(handleGroups.get(at) ?? []), point])
  }
  const active = current.find(p => p.id === selected)
  const handleMove = (point: BellPoint, dx: number) => {
    const seconds = Math.max(1, Math.min(durationSeconds - 1, Math.round(bellPointSeconds(point, durationSeconds) + dx / axisWidth * durationSeconds)))
    const fixed = point.kind === 'end' ? durationSeconds - seconds : seconds
    const value = point.kind === 'percent' ? Math.max(0.1, Math.min(99.9, Math.round(seconds / durationSeconds * 1000) / 10)) : fixed
    const next = points.map(p => p.id === point.id ? { ...p, value } : p)
    previewRef.current = next; setPreview(next); setSelected(point.id)
  }
  return <View testID="bell-points-editor" style={styles.block}>
    <View testID="bell-points-axis" onLayout={event => setAxisWidth(event.nativeEvent.layout.width)} style={styles.axis}>
      <View style={[styles.line, { backgroundColor: tokens.border }]} />
      <View style={[styles.boundary, { left: 0, backgroundColor: color }]} /><View style={[styles.boundary, { right: 0, backgroundColor: color }]} />
      {[...handleGroups.entries()].map(([at, group]) => { const point = group.find(p => p.id === selected) ?? group[0]; return <PointHandle key={point.id} point={point} count={group.length} label={`Move ${pointName(point)}`} color={color} selected={selected === point.id} left={bellPointSeconds(point, durationSeconds) / durationSeconds * 100} onPress={() => open(point)} onMove={dx => handleMove(point, dx)} onRelease={() => { if (previewRef.current) onChange(previewRef.current); previewRef.current = null; setPreview(null); selectionHaptic() }} onCancel={() => { previewRef.current = null; setPreview(null) }} onAdjust={direction => {
        const delta = point.kind === 'percent' ? 1 : secondPrecision ? 1 : 60
        const value = Math.max(point.kind === 'percent' ? 0.1 : 1, Math.min(point.kind === 'percent' ? 99.9 : 14400, point.value + direction * delta))
        onChange(points.map(p => p.id === point.id ? { ...p, value } : p)); selectionHaptic()
      }} /> })}
      {active && fits(active) ? <Text pointerEvents="none" numberOfLines={1} style={[styles.caption, { color: tokens.text }]}>{pointName(active)}</Text> : null}
      <Text style={[styles.start, { color: tokens.textMuted }]}>Start</Text><Text style={[styles.end, { color: tokens.textMuted }]}>{formatCompactDurationSeconds(durationSeconds)}</Text>
    </View>
    {!points.length ? <Text style={[styles.copy, { color: tokens.textMuted }]}>Place a bell at a percentage or a time inside this interval.</Text> : null}
    {sorted.map(point => <Pressable key={point.id} accessibilityRole="button" accessibilityLabel={`Edit ${pointName(point)}`} onPress={() => open(point)} style={[styles.row, { borderColor: point.id === selected ? color : tokens.border, opacity: fits(point) ? 1 : 0.6 }]}>
      <View style={[styles.dot, { backgroundColor: color }]} /><View style={styles.flex}><Text style={[styles.label, { color: tokens.text }]}>{pointName(point)}</Text><Text style={[styles.copy, { color: tokens.textMuted }]}>{fits(point) ? `${formatCompactDurationSeconds(bellPointSeconds(point, durationSeconds))} after start` : 'Outside this interval · kept for later'}</Text></View><Text style={{ color: tokens.textMuted }}>›</Text>
    </Pressable>)}
    <Pressable accessibilityRole="button" accessibilityLabel="Add point" disabled={points.length >= 32 || durationSeconds < 2} onPress={() => open()} style={[styles.add, { opacity: points.length >= 32 || durationSeconds < 2 ? 0.35 : 1 }]}><Text style={[styles.label, { color }]}>＋ Add point</Text></Pressable>
    <DraggableSheet visible={!!editing} title={points.some(p => p.id === editing?.id) ? 'Edit point' : 'Add point'} testID="bell-point-edit-sheet" presentation="center" fitContent partialHeightFraction={0.78} onClose={() => setEditing(null)}>
      {editing ? <View style={styles.block}>
        <View style={styles.units}><Chip label="Percentage" active={editing.kind === 'percent'} onPress={() => { if (editing.kind !== 'percent') { const value = Math.max(0.1, Math.min(99.9, Math.round(bellPointSeconds(editing, durationSeconds) / durationSeconds * 1000) / 10)); setPercent(String(value)); setEditing({ ...editing, kind: 'percent', value }) } }} /><Chip label="Time" active={editing.kind !== 'percent'} onPress={() => { if (editing.kind === 'percent') setEditing({ ...editing, kind: 'start', value: Math.max(1, Math.round(durationSeconds * (Number(percent) || 50) / 100)) }) }} /></View>
        {editing.kind === 'percent' ? <>
          <View style={[styles.percent, { borderColor: tokens.border }]}><TextInput accessibilityLabel="Percentage of interval" keyboardType="decimal-pad" value={percent} maxLength={5} onChangeText={value => { setPercent(value); setError(null) }} style={[styles.percentInput, { color: tokens.text }]} /><Text style={{ color: tokens.textMuted, fontSize: 24 }}>%</Text></View>
          <Slider accessibilityLabel="Point percentage" minimumValue={1} maximumValue={99} step={1} value={Math.max(1, Math.min(99, Number(percent) || 50))} onValueChange={value => setPercent(String(value))} minimumTrackTintColor={color} maximumTrackTintColor={tokens.border} thumbTintColor={color} />
        </> : <>
          <View style={styles.units}><Chip label="After start" active={editing.kind === 'start'} onPress={() => setEditing({ ...editing, kind: 'start' })} /><Chip label="Before end" active={editing.kind === 'end'} onPress={() => setEditing({ ...editing, kind: 'end' })} /></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Set point time" onPress={() => setTimeOpen(true)} style={[styles.time, { borderColor: tokens.border }]}><Text style={[styles.label, { color: tokens.text }]}>{formatCompactDurationSeconds(editing.value)}</Text><Text style={{ color: tokens.textMuted }}>›</Text></Pressable>
        </>}
        {error ? <Text accessibilityRole="alert" style={[styles.copy, { color: tokens.warm }]}>{error}</Text> : null}
        <View style={styles.buttons}>
          {points.some(p => p.id === editing.id) ? <Pressable accessibilityRole="button" accessibilityLabel="Remove point" onPress={() => { onChange(points.filter(p => p.id !== editing.id)); setEditing(null) }} style={styles.add}><Text style={{ color: tokens.warm }}>Remove</Text></Pressable> : <View />}
          <Pressable accessibilityRole="button" accessibilityLabel="Apply point" onPress={commit} style={[styles.apply, { backgroundColor: tokens.accent }]}><Text style={[styles.label, { color: '#fff' }]}>Apply</Text></Pressable>
        </View>
      </View> : null}
    </DraggableSheet>
    {timeOpen && editing ? <CustomMinutePicker title="Point time" initial={Math.ceil(editing.value / 60)} initialSeconds={editing.value} secondPrecision={secondPrecision} minSeconds={1} maxSeconds={14400} min={1} max={240} onConfirm={minutes => { setEditing({ ...editing, value: minutes * 60 }); setTimeOpen(false) }} onConfirmSeconds={value => { setEditing({ ...editing, value }); setTimeOpen(false) }} onClose={() => setTimeOpen(false)} /> : null}
  </View>
}

function PointHandle({ point, count, label, color, selected, left, onPress, onMove, onRelease, onCancel, onAdjust }: { point: BellPoint; count: number; label: string; color: string; selected: boolean; left: number; onPress: () => void; onMove: (dx: number) => void; onRelease: () => void; onCancel: () => void; onAdjust: (direction: number) => void }) {
  const callbacks = useRef({ onMove, onRelease, onCancel }); callbacks.current = { onMove, onRelease, onCancel }
  const dragCallbacks = useRef(callbacks.current)
  const originX = useRef(0)
  const suppressPressUntil = useRef(0)
  const pan = useRef(PanResponder.create({ onStartShouldSetPanResponder: e => { originX.current = e.nativeEvent.pageX; return false }, onMoveShouldSetPanResponder: (_, g) => { if (Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy)) { originX.current = g.moveX - g.dx; return true }; return false }, onPanResponderGrant: () => { dragCallbacks.current = callbacks.current; selectionHaptic() }, onPanResponderMove: (_, g) => dragCallbacks.current.onMove(g.moveX - originX.current), onPanResponderRelease: () => { suppressPressUntil.current = Date.now() + 300; callbacks.current.onRelease() }, onPanResponderTerminate: () => callbacks.current.onCancel(), onPanResponderTerminationRequest: () => false })).current
  return <View {...pan.panHandlers} style={[styles.handle, { left: `${left}%` }]}><Pressable accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: pointName(point) }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={e => onAdjust(e.nativeEvent.actionName === 'increment' ? 1 : -1)} onPress={() => { if (Date.now() >= suppressPressUntil.current) onPress() }} style={[styles.handleButton, selected && { borderColor: color, borderWidth: 1 }]}><View style={[styles.handleDot, { backgroundColor: color }, count > 1 && { width: 20, height: 20, borderRadius: 10 }]}>{count > 1 ? <Text style={{ color: '#fff', fontSize: 10, textAlign: 'center', lineHeight: 20 }}>{count}</Text> : null}</View></Pressable></View>
}
const styles = StyleSheet.create({
  block: { gap: 12 }, axis: { height: 118, marginHorizontal: 22 }, line: { position: 'absolute', left: 0, right: 0, top: 56, height: 2 }, boundary: { position: 'absolute', top: 49, height: 16, width: 2 },
  handle: { position: 'absolute', top: 35, marginLeft: -22, width: 44, height: 44 }, handleButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, handleDot: { width: 14, height: 14, borderRadius: 7 }, caption: { position: 'absolute', top: 4, alignSelf: 'center', fontSize: 14 }, start: { position: 'absolute', top: 85, left: -4, fontSize: 12 }, end: { position: 'absolute', top: 85, right: -4, fontSize: 12 },
  row: { minHeight: 64, padding: 12, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, dot: { width: 8, height: 8, borderRadius: 4 }, flex: { flex: 1 }, label: { fontSize: 15, fontWeight: '500' }, copy: { fontSize: 13, lineHeight: 19 }, add: { minHeight: 44, justifyContent: 'center' }, units: { flexDirection: 'row', gap: 8 }, percent: { borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }, percentInput: { flex: 1, minHeight: 58, fontSize: 28, textAlign: 'center' }, time: { minHeight: 52, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 }, buttons: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, apply: { borderRadius: 24, minHeight: 44, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
})
