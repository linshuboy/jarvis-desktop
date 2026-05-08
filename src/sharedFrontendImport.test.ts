import { ProcessTimeline, buildAgentProcessView, createCssVariables, digitalHumanModuleReady, frontendTokens, roleTones } from '@agi/frontend'

const desktopSharedImportSmoke = {
  canvas: createCssVariables(frontendTokens)['--agi-color-bg-canvas'],
  assistantLabel: roleTones.assistant.label,
  digitalHumanModuleReady,
  processVisibleEvents: buildAgentProcessView({ trace: { steps: [{ kind: 'plan_update', status: 'completed', summary: 'ok' }] } }).visibleEventCount,
  processTimelineType: typeof ProcessTimeline,
}

if (
  !desktopSharedImportSmoke.canvas ||
  desktopSharedImportSmoke.assistantLabel !== 'Assistant' ||
  desktopSharedImportSmoke.digitalHumanModuleReady !== true ||
  desktopSharedImportSmoke.processVisibleEvents !== 1 ||
  desktopSharedImportSmoke.processTimelineType !== 'function'
) {
  throw new Error('Desktop failed to consume shared frontend tokens')
}
