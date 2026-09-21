import { describe, expect, it } from 'vitest'
import { updateVisibleSheetStack } from '../visible-sheet-stack'

describe('visible sheet stack', () => {
  it('tracks the most recently opened sheet as the top layer', () => {
    const parent = updateVisibleSheetStack([], 'parent', true)
    expect(parent).toEqual(['parent'])
    expect(updateVisibleSheetStack(parent, 'child', true)).toEqual(['parent', 'child'])
  })

  it('reveals the parent again when a nested sheet closes', () => {
    expect(updateVisibleSheetStack(['parent', 'child'], 'child', false)).toEqual(['parent'])
  })

  it('moves a re-opened sheet to the top without duplicating it', () => {
    expect(updateVisibleSheetStack(['parent', 'child'], 'parent', true)).toEqual(['child', 'parent'])
  })

  it('preserves the current reference for no-op registrations', () => {
    const current = ['parent']
    expect(updateVisibleSheetStack(current, 'parent', true)).toBe(current)
    expect(updateVisibleSheetStack(current, 'missing', false)).toBe(current)
  })
})
