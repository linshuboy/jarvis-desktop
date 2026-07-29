import { Cable, CheckCircle2, Link2, RefreshCw, ShieldCheck } from 'lucide-react'
import { AgentProcessStream } from '@agi/frontend/web'

import { ActionButton, Definition, DefinitionGrid, IconButton, Panel, StateDot } from '../components/DesktopControls'
import { formatTimestamp } from './format'
import type { DesktopRuntimeProps } from './types'

export function DesktopRuntime({
  snapshot,
  effectiveAuth,
  configValidation,
  runtimeProcessView,
  loading,
  actionPending,
  onRefresh,
  onValidate,
  onBind,
  onReconnect,
}: DesktopRuntimeProps) {
  const online = Boolean(snapshot?.status.online)
  const paired = snapshot?.status.pairing_state === 'paired'

  return (
    <div className="desktop-view runtime-view">
      <section className="runtime-command-bar">
        <div className="runtime-identity">
          <StateDot active={online} tone={online ? 'teal' : 'orange'} />
          <div>
            <span>DESKTOP RUNTIME</span>
            <strong>{snapshot?.status.runtime_id || '正在读取设备身份'}</strong>
          </div>
        </div>
        <div className="runtime-command-actions">
          <IconButton disabled={loading || actionPending} icon={RefreshCw} label="刷新状态" onClick={onRefresh} />
          <ActionButton disabled={actionPending} icon={ShieldCheck} onClick={onValidate}>校验配置</ActionButton>
          <ActionButton disabled={actionPending || !effectiveAuth?.authenticated} icon={Link2} onClick={onBind}>重新绑定</ActionButton>
          <ActionButton disabled={actionPending || !snapshot?.status.has_runtime_token} icon={Cable} onClick={onReconnect} tone="primary">重新连接</ActionButton>
        </div>
      </section>

      <section className="runtime-grid">
        <Panel className="runtime-health" eyebrow="RUNTIME HEALTH" title="Helper 运行态">
          <div className="health-orbit">
            <div className={`health-core ${online ? 'is-online' : ''}`}>
              <span>{online ? 'ONLINE' : 'OFFLINE'}</span>
              <strong>{snapshot?.status.helper_pid || '--'}</strong>
              <small>HELPER PID</small>
            </div>
          </div>
          <div className="health-facts">
            <div><span>连接</span><strong>{snapshot?.status.connection_state || 'unknown'}</strong></div>
            <div><span>配对</span><strong>{snapshot?.status.pairing_state || 'unknown'}</strong></div>
            <div><span>最近在线</span><strong>{formatTimestamp(snapshot?.status.last_connected_at)}</strong></div>
          </div>
          {snapshot?.status.last_error ? <p className="inline-error" role="alert">{snapshot.status.last_error}</p> : null}
        </Panel>

        <Panel className="runtime-detail" eyebrow="SYSTEM SNAPSHOT" title="运行时详情">
          {snapshot ? (
            <DefinitionGrid>
              <Definition label="Bridge" value={snapshot.status.bridge_mode || snapshot.bridge} />
              <Definition label="Token" value={snapshot.status.has_runtime_token ? '已写入' : '缺失'} />
              <Definition label="Hostd" value={`${snapshot.version.version} / ${snapshot.version.commit}`} />
              <Definition label="管理模式" value={snapshot.helper_management.mode} />
              <Definition label="配置文件" value={snapshot.status.config_path} />
              <Definition label="状态文件" value={snapshot.status.state_path} />
              <Definition label="控制通道" value={snapshot.status.control_socket_path || '未启用'} />
              <Definition label="日志" value={snapshot.helper_management.helper_log_path} />
            </DefinitionGrid>
          ) : <p className="quiet-line">等待 helper snapshot</p>}
        </Panel>

        <Panel className="runtime-process" eyebrow="EXECUTION PLANE" title="运行过程">
          <AgentProcessStream view={runtimeProcessView} />
        </Panel>

        <Panel className="runtime-config" eyebrow="CONFIGURATION" title="执行能力边界">
          {configValidation?.valid ? (
            <>
              <div className="validation-state validation-state--valid">
                <CheckCircle2 aria-hidden="true" size={18} />
                <span>配置已通过校验</span>
              </div>
              <DefinitionGrid>
                <Definition label="Gateway" value={configValidation.config.gateway.ws_url} />
                <Definition label="TLS" value={configValidation.config.gateway.tls_mode} />
                <Definition label="设备名" value={configValidation.config.display_name} />
                <Definition label="心跳" value={`${configValidation.config.heartbeat_seconds}s`} />
              </DefinitionGrid>
              <div className="method-cloud">
                {configValidation.config.components.host.methods.map((method) => <code key={method}>{method}</code>)}
              </div>
            </>
          ) : (
            <div className="validation-state validation-state--invalid">
              <span>{configValidation?.error || '配置尚未读取'}</span>
            </div>
          )}
        </Panel>
      </section>
    </div>
  )
}
