import { Activity, ArrowUpRight, RefreshCw, Sparkles } from 'lucide-react'
import { AgentProcessStream } from '@agi/frontend/web'

import { ActionButton, IconButton, Metric, Panel, StateDot } from '../components/DesktopControls'
import { formatTimestamp } from './format'
import type { DesktopOverviewProps } from './types'

export function DesktopOverview({
  snapshot,
  effectiveAuth,
  runtimeProcessView,
  loading,
  actionPending,
  onOpenRuntime,
  onRefresh,
}: DesktopOverviewProps) {
  const online = Boolean(snapshot?.status.online)
  const paired = snapshot?.status.pairing_state === 'paired'
  const runtimeStatus = loading ? '同步中' : online ? '在线' : paired ? '待连接' : '待绑定'

  return (
    <div className="desktop-view desktop-overview">
      <section className="overview-stage">
        <div className="stage-copy">
          <span className="stage-kicker">AUTONOMY PULSE</span>
          <div className="stage-status">
            <StateDot active={online} tone={online ? 'teal' : 'orange'} />
            <span>{runtimeStatus}</span>
          </div>
          <h2>{online ? '执行环境保持就绪' : paired ? '设备已绑定，等待连接恢复' : '完成连接后接管执行环境'}</h2>
          <p>{snapshot?.status.last_error || '当前没有需要人工处理的运行时错误。'}</p>
          <div className="stage-actions">
            <ActionButton icon={Activity} onClick={onOpenRuntime} tone="primary">
              查看运行时
            </ActionButton>
            <ActionButton icon={Sparkles} onClick={onRefresh}>
              刷新状态
            </ActionButton>
          </div>
        </div>

        <div className="stage-facts">
          <div>
            <span>账号</span>
            <strong>{effectiveAuth?.authenticated ? effectiveAuth.user?.display_name || effectiveAuth.user?.username : '未登录'}</strong>
          </div>
          <div>
            <span>Gateway</span>
            <strong>{snapshot?.status.last_gateway_url || '未配置'}</strong>
          </div>
          <div>
            <span>最近连接</span>
            <strong>{formatTimestamp(snapshot?.status.last_connected_at)}</strong>
          </div>
        </div>
      </section>

      <section className="metric-strip" aria-label="运行概览">
        <Metric label="Helper" value={snapshot?.status.helper_available ? '可用' : '不可用'} tone={snapshot?.status.helper_available ? 'good' : 'warn'} />
        <Metric label="设备绑定" value={snapshot?.status.pairing_state || 'unknown'} tone={paired ? 'good' : 'warn'} />
        <Metric label="Bridge" value={snapshot?.status.bridge_mode || snapshot?.bridge || 'loading'} />
        <Metric label="Hostd" value={snapshot?.version.version || 'unknown'} />
      </section>

      <section className="overview-lower-grid">
        <Panel
          actions={<IconButton disabled={loading || actionPending} icon={RefreshCw} label="刷新运行状态" onClick={onRefresh} />}
          className="process-surface"
          eyebrow="EVIDENCE STREAM"
          title="执行证据"
        >
          {runtimeProcessView.visibleEventCount > 0 ? (
            <AgentProcessStream view={runtimeProcessView} />
          ) : (
            <div className="quiet-line">等待运行时事件</div>
          )}
        </Panel>

        <Panel className="next-action-surface" eyebrow="NEXT ACTION" title="连接完整度">
          <ol className="readiness-list">
            <li className={effectiveAuth?.authenticated ? 'is-complete' : ''}>
              <span>01</span>
              <div><strong>账号会话</strong><small>{effectiveAuth?.authenticated ? '已认证' : '等待登录'}</small></div>
            </li>
            <li className={paired ? 'is-complete' : ''}>
              <span>02</span>
              <div><strong>设备绑定</strong><small>{paired ? 'Token 已写入' : '等待绑定'}</small></div>
            </li>
            <li className={online ? 'is-complete' : ''}>
              <span>03</span>
              <div><strong>Gateway 通道</strong><small>{online ? '在线' : '等待连接'}</small></div>
            </li>
          </ol>
          <button className="text-link" onClick={onOpenRuntime} type="button">
            打开运行时详情 <ArrowUpRight aria-hidden="true" size={15} />
          </button>
        </Panel>
      </section>
    </div>
  )
}
