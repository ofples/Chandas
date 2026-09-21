import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Platform } from 'react-native'
import { MAX_CONFIGURATION_TRANSFER_CHARACTERS } from './configuration-transfer'

export async function copyConfigurationText(text: string): Promise<void> {
  const copied = await Clipboard.setStringAsync(text)
  if (!copied) throw new Error('Clipboard write was not accepted.')
}

export async function readConfigurationTextFromClipboard(): Promise<string> {
  return Clipboard.getStringAsync()
}

export async function pickConfigurationText(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
    base64: false,
  })
  if (result.canceled || !result.assets[0]) return null
  const asset = result.assets[0]
  if (typeof asset.size === 'number' && asset.size > MAX_CONFIGURATION_TRANSFER_CHARACTERS * 4) {
    throw new Error('Configuration file is too large.')
  }
  if (Platform.OS === 'web' && asset.file) return asset.file.text()
  return new File(asset.uri).text()
}

export async function saveConfigurationFile(filename: string, text: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([text], { type: 'application/json' })
    const uri = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = uri
    link.download = filename
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(uri)
    return
  }

  if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable.')
  const file = new File(Paths.cache, filename)
  file.create({ overwrite: true })
  file.write(text)
  try {
    await Sharing.shareAsync(file.uri, {
      dialogTitle: 'Save Chandas configuration',
      mimeType: 'application/json',
      UTI: 'public.json',
    })
  } finally {
    if (file.exists) file.delete()
  }
}
