import { describe, expect, it } from 'vitest'
import { insertUnifiedStepAfter } from '../unified-editing'

describe('insertUnifiedStepAfter', () => {
  it('puts a duplicate directly below its source and leaves other step order intact', () => {
    const source = [{ id: 'warmup' }, { id: 'work' }, { id: 'rest' }]
    expect(insertUnifiedStepAfter(source, 'work', { id: 'work-copy' })).toEqual([
      { id: 'warmup' }, { id: 'work' }, { id: 'work-copy' }, { id: 'rest' },
    ])
  })

  it('keeps a valid result if the source disappeared before insertion', () => {
    expect(insertUnifiedStepAfter([{ id: 'remaining' }], 'missing', { id: 'copy' })).toEqual([
      { id: 'remaining' }, { id: 'copy' },
    ])
  })
})
