import type { ComponentProps } from 'react'
import type { AgentProcessStream } from '@agi/frontend/web'

import type { ConfigValidation, DesktopAuthState, DesktopClientUpdateCheck, DesktopSnapshot } from '../types'

export type RuntimeProcessView = ComponentProps<typeof AgentProcessStream>['view']

export type DesktopBaseViewProps = {
  snapshot: DesktopSnapshot | null
  effectiveAuth: DesktopAuthState | null
  loading: boolean
  actionPending: boolean
}

export type DesktopOverviewProps = DesktopBaseViewProps & {
  runtimeProcessView: RuntimeProcessView
  onOpenRuntime: () => void
  onRefresh: () => void
}

export type DesktopRuntimeProps = DesktopBaseViewProps & {
  configValidation: ConfigValidation | null
  runtimeProcessView: RuntimeProcessView
  onRefresh: () => void
  onValidate: () => void
  onBind: () => void
  onReconnect: () => void
}

export type DesktopSettingsProps = DesktopBaseViewProps & {
  serverUrlInput: string
  usernameInput: string
  passwordInput: string
  clientUpdateProxyInput: string
  clientUpdate: DesktopClientUpdateCheck | null
  clientUpdatePending: boolean
  clientUpdateMessage: string
  clientUpdateError: string
  onServerUrlChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onClientUpdateProxyChange: (value: string) => void
  onLogin: () => void
  onLogout: () => void
  onBind: () => void
  onReconnect: () => void
  onSetAutostart: (enabled: boolean) => void
  onCheckClientUpdate: () => void
  onDownloadClientUpdate: () => void
  onInstallClientUpdate: () => void
  onQuitApplication: () => void
}
