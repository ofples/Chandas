// Type declarations for the Document Picture-in-Picture API
// https://wicg.github.io/document-picture-in-picture/

interface DocumentPictureInPictureOptions {
  width?: number
  height?: number
  disallowReturnToOpener?: boolean
}

interface DocumentPictureInPicture extends EventTarget {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>
  readonly window: Window | null
  onenter: ((this: DocumentPictureInPicture, ev: DocumentPictureInPictureEvent) => void) | null
}

interface DocumentPictureInPictureEvent extends Event {
  readonly window: Window
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture
  }
}

export {}
