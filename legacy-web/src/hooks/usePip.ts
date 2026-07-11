import { useCallback, useRef, useState } from 'react'

function copyStylesToWindow(target: Window) {
  // Copy Google Fonts link (loaded in <head>)
  document.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
    target.document.head.appendChild(el.cloneNode(true))
  })

  // Copy all <style> blocks (Vite injects CSS as <style> tags in production)
  document.querySelectorAll('style').forEach(el => {
    target.document.head.appendChild(el.cloneNode(true))
  })

  // Base resets for the pip document body
  const base = target.document.createElement('style')
  base.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: var(--bg); overflow: hidden; }
    #pip-root { width: 100%; height: 100%; display: flex; }
  `
  target.document.head.appendChild(base)
}

interface UsePipReturn {
  isSupported: boolean
  isPip: boolean
  pipContainer: HTMLElement | null
  open: () => Promise<void>
  close: () => void
}

export function usePip(): UsePipReturn {
  const isSupported = typeof window !== 'undefined' && 'documentPictureInPicture' in window
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null)
  const pipWinRef = useRef<Window | null>(null)

  const open = useCallback(async () => {
    if (!window.documentPictureInPicture) return

    // Close any existing pip window first
    pipWinRef.current?.close()

    const pipWin = await window.documentPictureInPicture.requestWindow({
      width: 160,
      height: 52,
      disallowReturnToOpener: false,
    })

    copyStylesToWindow(pipWin)

    const container = pipWin.document.createElement('div')
    container.id = 'pip-root'
    pipWin.document.body.appendChild(container)

    pipWinRef.current = pipWin
    setPipContainer(container)

    pipWin.addEventListener('pagehide', () => {
      pipWinRef.current = null
      setPipContainer(null)
    })
  }, [])

  const close = useCallback(() => {
    pipWinRef.current?.close()
  }, [])

  return {
    isSupported,
    isPip: pipContainer !== null,
    pipContainer,
    open,
    close,
  }
}
