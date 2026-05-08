import {
  DigitalHumanPanel,
  createDigitalHumanStatusSummary,
  createInitialDigitalHumanVisualState,
  runDigitalHumanKernelTask,
  type AvatarVisualState,
} from '@agi/frontend'

const state: AvatarVisualState = {
  ...createInitialDigitalHumanVisualState('2026-04-29T00:00:00Z'),
  state: 'listening',
  message: '桌面数字人模式 smoke test',
}

const desktopDigitalHumanModeSmoke = {
  panelType: typeof DigitalHumanPanel,
  statusType: typeof createDigitalHumanStatusSummary,
  taskBridgeType: typeof runDigitalHumanKernelTask,
  className: DigitalHumanPanel({ visualState: state }).props.className,
  state: state.state,
}

if (
  desktopDigitalHumanModeSmoke.panelType !== 'function' ||
  desktopDigitalHumanModeSmoke.statusType !== 'function' ||
  desktopDigitalHumanModeSmoke.taskBridgeType !== 'function' ||
  !desktopDigitalHumanModeSmoke.className.includes('agi-digital-human-panel--listening') ||
  desktopDigitalHumanModeSmoke.state !== 'listening'
) {
  throw new Error('Desktop digital human mode failed to consume the shared panel')
}
