import { useId, useState } from 'react'

interface Props {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  title?: string
  /** Hide the visible label (still used as the accessible name). */
  compact?: boolean
}

/** Number input that keeps what is being typed and only reports valid values. */
export default function NumberField({ label, value, onChange, min, max, step, suffix, title, compact }: Props) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(+value.toPrecision(7))
  const n = Number(draft)
  const bad = draft !== null && (draft.trim() === '' || !Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max))
  return (
    <div className="field" title={title}>
      {!compact && (
        <label htmlFor={id}>
          {label}
          {suffix ? <span className="suffix"> ({suffix})</span> : null}
        </label>
      )}
      <input
        id={id}
        aria-label={compact ? label : undefined}
        type="number"
        inputMode="decimal"
        className={bad ? 'bad' : undefined}
        value={shown}
        min={min}
        max={max}
        step={step ?? 'any'}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          const text = e.target.value
          setDraft(text)
          const v = Number(text)
          if (text.trim() !== '' && Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) onChange(v)
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  )
}
