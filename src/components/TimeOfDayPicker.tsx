import { CustomMinutePicker } from './CustomMinutePicker'

interface Props {
  title: string
  initial: number
  onConfirm: (minutes: number) => void
  onClose: () => void
}

export function TimeOfDayPicker({ title, initial, onConfirm, onClose }: Props) {
  return <CustomMinutePicker title={title} initial={initial} clockTime onConfirm={onConfirm} onClose={onClose} />
}
