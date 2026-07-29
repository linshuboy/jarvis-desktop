import { AgentProcessStream, SpatialAppShell } from '@agi/frontend/web'

import { DesktopOverview } from './views/DesktopOverview'
import { DesktopRuntime } from './views/DesktopRuntime'
import { DesktopSettings } from './views/DesktopSettings'

const spatialArchitectureSmoke = {
  shell: typeof SpatialAppShell,
  processStream: typeof AgentProcessStream,
  overview: typeof DesktopOverview,
  runtime: typeof DesktopRuntime,
  settings: typeof DesktopSettings,
}

if (Object.values(spatialArchitectureSmoke).some((value) => value !== 'function')) {
  throw new Error('Desktop spatial architecture is missing a shared primitive or host view')
}
