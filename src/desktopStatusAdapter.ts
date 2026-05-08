import { buildAgentProcessView, type AgentProcessView } from '@agi/frontend'

import type { ConfigValidation, DesktopAuthState, DesktopSnapshot } from './types'

export type DesktopRuntimeProcessViewInput = {
  snapshot: DesktopSnapshot | null
  effectiveAuth: DesktopAuthState | null
  configValidation: ConfigValidation | null
}

export function createDesktopRuntimeProcessView({
  snapshot,
  effectiveAuth,
  configValidation,
}: DesktopRuntimeProcessViewInput): AgentProcessView {
  const helperStatus = snapshot?.status.online
    ? 'running'
    : snapshot?.status.last_error
      ? 'failed'
      : 'pending'
  const authStatus = effectiveAuth?.authenticated ? 'completed' : 'pending'
  const configStatus = configValidation?.valid ? 'completed' : configValidation && !configValidation.valid ? 'failed' : 'pending'

  return buildAgentProcessView({
    workItemId: snapshot?.status.runtime_id || 'desktop-runtime',
    status: helperStatus,
    trace: {
      status: helperStatus,
      lanes: [{ lane_id: 'desktop', run_id: 'desktop', label: 'Desktop Runtime' }],
      steps: [
        {
          step_id: 'desktop-auth',
          run_id: 'desktop',
          lane_id: 'desktop',
          label: '登录状态',
          kind: 'plan_update',
          status: authStatus,
          serial_index: 1,
          summary: effectiveAuth?.authenticated
            ? `已登录 ${effectiveAuth.user?.display_name || effectiveAuth.user?.username || '当前用户'}`
            : '等待登录后绑定当前设备。',
        },
        {
          step_id: 'desktop-helper',
          run_id: 'desktop',
          lane_id: 'desktop',
          label: 'Helper 状态',
          kind: 'machine_load',
          status: helperStatus,
          serial_index: 2,
          summary: snapshot?.status.online
            ? `helper 在线，runtime ${snapshot.status.runtime_id || '未生成'}`
            : snapshot?.status.last_error || '等待 helper 上线。',
          detail: {
            machine_id: snapshot?.status.runtime_id || '',
          },
        },
        {
          step_id: 'desktop-gateway',
          run_id: 'desktop',
          lane_id: 'desktop',
          label: 'Gateway 连接',
          kind: 'workspace_set',
          status: snapshot?.status.connection_state === 'connected' ? 'completed' : helperStatus,
          serial_index: 3,
          summary: snapshot?.status.last_gateway_url || effectiveAuth?.server_url || '未配置 Gateway。',
          detail: {
            path: snapshot?.status.last_gateway_url || effectiveAuth?.server_url || '',
          },
        },
        {
          step_id: 'desktop-config',
          run_id: 'desktop',
          lane_id: 'desktop',
          label: '配置校验',
          kind: 'finish',
          status: configStatus,
          serial_index: 4,
          summary: configValidation?.valid
            ? 'helper 配置可用。'
            : configValidation && !configValidation.valid
              ? configValidation.error
              : '尚未完成配置校验。',
        },
      ],
    },
  })
}
