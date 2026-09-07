import { createContext, type ReactNode, use, useCallback, useMemo, useState } from 'react'
import { updateVisibleSheetStack } from '../../lib/visible-sheet-stack'
import type { AppNotice } from './experience-feedback'
import { FeedbackBanner } from './experience-feedback'

interface FeedbackLayerValue {
  notice: AppNotice | null
  onDismiss: () => void
  activeSheetId: string | null
  setSheetVisible: (id: string, visible: boolean) => void
}

const FeedbackLayerContext = createContext<FeedbackLayerValue | null>(null)

export function FeedbackLayerProvider({ notice, onDismiss, children }: { notice: AppNotice | null; onDismiss: () => void; children: ReactNode }) {
  const [sheetIds, setSheetIds] = useState<string[]>([])
  const setSheetVisible = useCallback((id: string, visible: boolean) => {
    setSheetIds(current => updateVisibleSheetStack(current, id, visible))
  }, [])
  const activeSheetId = sheetIds.at(-1) ?? null
  const value = useMemo(() => ({ notice, onDismiss, activeSheetId, setSheetVisible }), [activeSheetId, notice, onDismiss, setSheetVisible])
  return <FeedbackLayerContext value={value}>{children}</FeedbackLayerContext>
}

export function RootFeedbackOverlay({ hidden = false }: { hidden?: boolean }) {
  const layer = use(FeedbackLayerContext)
  if (!layer || hidden || layer.activeSheetId) return null
  return <FeedbackBanner notice={layer.notice} onDismiss={layer.onDismiss} />
}

export function SheetFeedbackOverlay({ sheetId }: { sheetId: string }) {
  const layer = use(FeedbackLayerContext)
  if (!layer || layer.activeSheetId !== sheetId) return null
  return <FeedbackBanner notice={layer.notice} onDismiss={layer.onDismiss} />
}

export function useFeedbackSheetRegistration() {
  const layer = use(FeedbackLayerContext)
  return layer?.setSheetVisible
}
