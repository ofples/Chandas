import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppTimerSettings, UnifiedTimerProgram, WorkingProgramState } from '../types'
import { nativeTimerRun } from '../native/ChandasTimerService'
import { createProgramId } from '../lib/timerV2'
import { useTimerV2, type RunAlarmQueue, type RunCueArbitrator, type TimerRestore, type UseTimerV2Return } from './useTimerV2'

export interface RunInput {
  program: UnifiedTimerProgram
  settings: AppTimerSettings
  sourcePreset?: WorkingProgramState['sourcePreset']
}

interface RunEntry {
  id: string
  input: RunInput
  restore?: TimerRestore
}

function createAlarmQueue(): RunAlarmQueue {
  let owner: string | null = null
  const waiting = new Map<string, () => boolean>()
  const advance = () => {
    for (const [id, ring] of waiting) {
      waiting.delete(id)
      owner = id
      if (ring()) return
      owner = null
    }
  }
  return {
    enqueue(id, ring) {
      if (owner === id || waiting.has(id)) return
      waiting.set(id, ring)
      if (!owner) advance()
    },
    cancelPending(id) {
      waiting.delete(id)
    },
    release(id) {
      waiting.delete(id)
      if (owner !== id) return
      owner = null
      advance()
    },
  }
}

function createCueArbitrator(): RunCueArbitrator {
  type Candidate = Parameters<RunCueArbitrator['offer']>[0]
  type Offer = Candidate & { resolve: (wins: boolean) => void }
  const batches = new Map<number, Offer[]>()
  return {
    offer(candidate) {
      return new Promise(resolve => {
        const batch = batches.get(candidate.at)
        if (batch) { batch.push({ ...candidate, resolve }); return }
        const offers = [{ ...candidate, resolve }]
        batches.set(candidate.at, offers)
        // Independent browser timers with the same deadline can run in separate tasks.
        setTimeout(() => {
          batches.delete(candidate.at)
          const winner = offers.filter(offer => offer.isCurrent()).sort((a, b) =>
            Number(b.alarm) - Number(a.alarm) || (a.rarity === b.rarity ? 0 : b.rarity - a.rarity)
            || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
          offers.forEach(offer => offer.resolve(offer === winner))
        }, 25)
      })
    },
  }
}

const RunController = memo(function RunController({ entry, alarms, cues, onView, onStarted, onEnded }: {
  entry: RunEntry
  alarms: RunAlarmQueue
  cues: RunCueArbitrator
  onView: (id: string, view: UseTimerV2Return) => void
  onStarted: (id: string, accepted: boolean) => void
  onEnded: (id: string, completed: boolean) => void
}) {
  const scope = useMemo(() => ({ key: entry.id, native: nativeTimerRun(entry.id, entry.input.sourcePreset?.name), alarms, cues }), [entry.id, entry.input.sourcePreset?.name, alarms, cues])
  const timer = useTimerV2(entry.input.program, entry.input.settings, entry.input.sourcePreset, scope)
  const started = useRef(false)
  const wasRunning = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const ready = entry.restore && scope.native
      ? timer.attachNativeSession(entry.restore).then(() => true)
      : timer.start(entry.restore, entry.input)
    void ready.then(
      accepted => onStarted(entry.id, accepted),
      () => onStarted(entry.id, false),
    )
  }, [entry, onStarted, scope, timer.attachNativeSession, timer.start])
  useEffect(() => {
    onView(entry.id, timer)
    if (wasRunning.current && !timer.isRunning) onEnded(entry.id, timer.completionPulse > 0)
    wasRunning.current = timer.isRunning
  })
  return null
})

/** Mounted independently of the visible watchface or setup route. */
export function useTimerRunPool(onEnded: (id: string, completed: boolean) => void) {
  const [alarms] = useState(createAlarmQueue)
  const [cues] = useState(createCueArbitrator)
  const [entries, setEntries] = useState<RunEntry[]>([])
  const [views, setViews] = useState<ReadonlyMap<string, UseTimerV2Return>>(new Map())
  const entriesRef = useRef(entries)
  const viewsRef = useRef(views)
  const pending = useRef(new Map<string, (id: string | null) => void>())
  const endRef = useRef(onEnded)
  endRef.current = onEnded

  const publishEntries = useCallback((next: RunEntry[]) => {
    entriesRef.current = next
    setEntries(next)
  }, [])
  const onView = useCallback((id: string, view: UseTimerV2Return) => {
    if (!entriesRef.current.some(entry => entry.id === id)) return
    viewsRef.current = new Map(viewsRef.current).set(id, view)
    setViews(viewsRef.current)
  }, [])
  const remove = useCallback((id: string) => {
    publishEntries(entriesRef.current.filter(entry => entry.id !== id))
    const nextViews = new Map(viewsRef.current)
    nextViews.delete(id)
    viewsRef.current = nextViews
    setViews(nextViews)
  }, [publishEntries])
  const onStarted = useCallback((id: string, accepted: boolean) => {
    const resolve = pending.current.get(id)
    pending.current.delete(id)
    if (!accepted) remove(id)
    resolve?.(accepted ? id : null)
  }, [remove])
  const finish = useCallback((id: string, completed: boolean) => endRef.current(id, completed), [])
  const launch = useCallback((input: RunInput, restore?: TimerRestore): Promise<string | null> => {
    if (entriesRef.current.some(entry => entry.input.sourcePreset?.id === input.sourcePreset?.id)) return Promise.resolve(null)
    const id = restore?.sessionId ?? createProgramId()
    return new Promise(resolve => {
      pending.current.set(id, resolve)
      publishEntries([...entriesRef.current, { id, input, restore }])
    })
  }, [publishEntries])
  const patch = useCallback((id: string, input: RunInput) => {
    publishEntries(entriesRef.current.map(entry => entry.id === id ? { ...entry, input } : entry))
  }, [publishEntries])
  const hosts = entries.map(entry => <RunController key={entry.id} entry={entry} alarms={alarms} cues={cues} onView={onView} onStarted={onStarted} onEnded={finish} />)
  return { entries, views, entriesRef, viewsRef, launch, patch, remove, hosts }
}
