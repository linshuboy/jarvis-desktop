import { createDigitalHumanStatusSummary, createInitialDigitalHumanVisualState } from '@agi/frontend'

const status = createDigitalHumanStatusSummary({
  ...createInitialDigitalHumanVisualState('2026-04-29T00:00:00Z'),
  state: 'executing',
})
const statusClassName = String((status as { props: { className?: string } }).props.className || '')

if (typeof createDigitalHumanStatusSummary !== 'function' || !statusClassName.includes('executing')) {
  throw new Error('Desktop digital human status summary did not render executing state')
}
