import { buildAgentProcessView } from '@agi/frontend/agent'
import { AgentProcessStream, createCssVariables, frontendTokens, roleTones } from '@agi/frontend/web'

const desktopSharedImportSmoke = {
  canvas: createCssVariables(frontendTokens)['--agi-surface-canvas'],
  assistantLabel: roleTones.assistant.label,
  processVisibleEvents: buildAgentProcessView({ trace: { steps: [{ kind: 'plan_update', status: 'completed', summary: 'ok' }] } }).visibleEventCount,
  processStreamType: typeof AgentProcessStream,
}

if (
  !desktopSharedImportSmoke.canvas ||
  desktopSharedImportSmoke.assistantLabel !== 'Assistant' ||
  desktopSharedImportSmoke.processVisibleEvents !== 1 ||
  desktopSharedImportSmoke.processStreamType !== 'function'
) {
  throw new Error('Desktop failed to consume shared frontend tokens')
}
