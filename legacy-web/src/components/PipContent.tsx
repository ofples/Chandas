// Rendered inside the floating Picture-in-Picture window via React portal.
// The browser's native title bar provides the close (×) button.

interface Props {
  mainCountdown: string
}

export function PipContent({ mainCountdown }: Props) {
  return (
    <div className="pip-wrap">
      <span className="pip-main">{mainCountdown}</span>
    </div>
  )
}
