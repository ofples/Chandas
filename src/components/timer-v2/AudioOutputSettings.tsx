import { useEffect, useState } from 'react'
import { PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChandasTimerService, type TimerAudioOutput } from '../../native/ChandasTimerService'
import { useTheme } from '../../theme/ThemeContext'
import { Toggle } from '../Toggle'

const choices: ReadonlyArray<{ id: TimerAudioOutput; label: string }> = [
  { id: 'phone', label: 'Phone speaker' },
  { id: 'external', label: 'External speaker' },
  { id: 'headphones', label: 'Headphones' },
]

export function AudioOutputSettings({ onSaveError }: { onSaveError: () => void }) {
  const { tokens } = useTheme()
  const [outputs, setOutputs] = useState(() => ChandasTimerService.getAudioOutputs() ?? [])
  const requiresBluetoothAccess = Platform.OS === 'android' && Number(Platform.Version) >= 31
  const [bluetoothAccess, setBluetoothAccess] = useState(!requiresBluetoothAccess)
  useEffect(() => {
    if (!requiresBluetoothAccess) return
    void PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT).then(setBluetoothAccess)
  }, [requiresBluetoothAccess])
  const change = (next: TimerAudioOutput[]) => {
    if (ChandasTimerService.setAudioOutputs(next)) setOutputs(next)
    else onSaveError()
  }
  const automatic = outputs.length === 0
  return <View style={styles.section}>
    <View style={styles.row}>
      <Text style={[styles.label, { color: tokens.text }]}>Follow Android</Text>
      <Toggle value={automatic} onChange={value => change(value ? [] : ['phone'])} accessibilityLabel="Follow Android audio routing" />
    </View>
    {automatic ? <Text style={[styles.detail, { color: tokens.textMuted }]}>Use Android's usual output for Chandas sounds.</Text> : <>
      {choices.map(({ id, label }) => <View key={id} style={styles.row}>
        <Text style={[styles.label, { color: tokens.text }]}>{label}</Text>
        <Toggle value={outputs.includes(id)} disabled={outputs.length === 1 && outputs[0] === id} onChange={value => change(value ? [...outputs, id] : outputs.filter(output => output !== id))} accessibilityLabel={label} />
      </View>)}
      <Text style={[styles.detail, { color: tokens.textMuted }]}>Among your selections, Chandas prefers headphones, then an external speaker, then the phone speaker. If Android can’t use an allowed output, Chandas stays quiet.</Text>
      {!bluetoothAccess && (outputs.includes('headphones') || outputs.includes('external')) ? <Pressable accessibilityRole="button" style={[styles.button, { borderColor: tokens.border }]} onPress={() => {
        void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT).then(result => {
          setBluetoothAccess(result === PermissionsAndroid.RESULTS.GRANTED)
        })
      }}><Text style={{ color: tokens.text }}>Identify Bluetooth devices</Text></Pressable> : null}
    </>}
  </View>
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1, fontSize: 15, fontWeight: '600' },
  detail: { fontSize: 13, lineHeight: 19 },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 12, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
})
