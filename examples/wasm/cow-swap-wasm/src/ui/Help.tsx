// A small "?" affordance that reveals explanatory text on hover or focus.
// Newlines in `text` render as breaks.
export function Help({ text }: { text: string }) {
  return (
    <span className="help" tabIndex={0} role="note" aria-label={text}>
      <span className="help-mark" aria-hidden="true">
        ?
      </span>
      <span className="help-tip" role="tooltip">
        {text}
      </span>
    </span>
  )
}
