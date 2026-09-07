/** Keeps the most recently opened sheet at the top without duplicating registrations. */
export function updateVisibleSheetStack(current: string[], id: string, visible: boolean): string[] {
  const existingIndex = current.indexOf(id)

  if (!visible) {
    if (existingIndex === -1) return current
    return current.filter(value => value !== id)
  }

  if (existingIndex !== -1 && existingIndex === current.length - 1) return current
  return [...current.filter(value => value !== id), id]
}
