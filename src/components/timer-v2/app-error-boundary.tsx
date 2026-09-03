import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

interface Props { children: ReactNode }
interface State { failed: boolean }

/** Last-resort UI protection; operational errors are handled closer to their controls. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (__DEV__) console.error('Chandas UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <View style={styles.screen} accessibilityRole="alert">
        <View style={styles.mark}><Text style={styles.markText}>○</Text></View>
        <Text selectable style={styles.title}>Let’s try that again</Text>
        <Text selectable style={styles.message}>The timer service is safe. This screen had trouble drawing, so Chandas paused the controls here.</Text>
        <Pressable onPress={() => this.setState({ failed: false })} accessibilityRole="button" style={({ pressed }) => [styles.button, { opacity: pressed ? 0.72 : 1 }]}>
          <Text style={styles.buttonText}>Return to Chandas</Text>
        </Pressable>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#0b0c10' },
  mark: { width: 58, height: 58, borderWidth: 1.5, borderColor: '#7c6ff7', borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  markText: { color: '#7c6ff7', fontSize: 30, fontWeight: '300' },
  title: { color: '#e8e8f0', fontSize: 21, fontWeight: '700', textAlign: 'center' },
  message: { maxWidth: 360, color: '#8b8ba3', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  button: { minHeight: 48, marginTop: 8, paddingHorizontal: 20, borderRadius: 9999, backgroundColor: '#7c6ff7', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
})
