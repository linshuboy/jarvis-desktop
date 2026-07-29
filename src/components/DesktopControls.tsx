import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { PaneHeader, Surface } from '@agi/frontend/web'

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className = '',
}: {
  title?: string
  eyebrow?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Surface className={`desktop-panel ${className}`.trim()} tone="floating">
      {title || eyebrow || actions ? (
        <PaneHeader actions={actions} eyebrow={eyebrow} title={title || ''} />
      ) : null}
      {children}
    </Surface>
  )
}

export function Metric({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  return (
    <div className={`desktop-metric desktop-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function StateDot({ active, tone = 'teal' }: { active: boolean; tone?: 'teal' | 'blue' | 'orange' | 'red' }) {
  return <span className={`state-dot state-dot--${tone} ${active ? 'is-active' : ''}`} aria-hidden="true" />
}

export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  tone = 'quiet',
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'quiet' | 'primary' | 'danger'
}) {
  return (
    <button
      aria-label={label}
      className={`icon-button icon-button--${tone}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
    </button>
  )
}

export function ActionButton({
  icon: Icon,
  children,
  onClick,
  disabled = false,
  tone = 'secondary',
}: {
  icon?: LucideIcon
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'primary' | 'secondary' | 'danger'
}) {
  return (
    <button className={`action-button action-button--${tone}`} disabled={disabled} onClick={onClick} type="button">
      {Icon ? <Icon aria-hidden="true" size={16} strokeWidth={1.9} /> : null}
      <span>{children}</span>
    </button>
  )
}

export function DefinitionGrid({ children }: { children: ReactNode }) {
  return <dl className="definition-grid">{children}</dl>
}

export function Definition({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
