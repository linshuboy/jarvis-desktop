import { startTransition, useEffect, useMemo, useState } from 'react'

import {
  clearRuntimeToken,
  getDesktopSnapshot,
  quitDesktopApplication,
  setRuntimeToken,
  setDesktopAutostart,
  validateDesktopConfig,
} from './bridge'
import type { ConfigValidation, DesktopSnapshot } from './types'

function formatTimestamp(value: string): string {
  if (!value) {
    return '未连接'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-CN', { hour12: false })
}

function pairingTone(state: string): string {
  switch (state) {
    case 'paired':
      return 'pill pill-success'
    case 'pending':
      return 'pill pill-warn'
    case 'revoked':
      return 'pill pill-danger'
    default:
      return 'pill'
  }
}

function statusTone(snapshot: DesktopSnapshot | null): string {
  if (snapshot === null) {
    return 'pill'
  }
  if (snapshot.status.online) {
    return 'pill pill-success'
  }
  if (snapshot.status.last_error) {
    return 'pill pill-danger'
  }
  return 'pill pill-warn'
}

export default function App() {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionPending, setActionPending] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')

  async function refreshSnapshot() {
    setError('')
    const next = await getDesktopSnapshot()
    startTransition(() => {
      setSnapshot(next)
      setLoading(false)
    })
    return next
  }

  useEffect(() => {
    let disposed = false
    setLoading(true)
    refreshSnapshot().catch((nextError: unknown) => {
      if (disposed) {
        return
      }
      setError(nextError instanceof Error ? nextError.message : '加载桌面状态失败')
      setLoading(false)
    })
    const timer = window.setInterval(() => {
      refreshSnapshot().catch(() => {
        return
      })
    }, 5000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  const cards = useMemo(() => {
    if (snapshot === null) {
      return []
    }
    return [
      {
        label: 'Bridge',
        value: snapshot.status.bridge_mode || snapshot.bridge,
      },
      {
        label: 'Runtime ID',
        value: snapshot.status.runtime_id || '尚未生成',
      },
      {
        label: '最近连接',
        value: formatTimestamp(snapshot.status.last_connected_at),
      },
      {
        label: 'Gateway',
        value: snapshot.status.last_gateway_url || '未配置',
      },
      {
        label: 'Connection',
        value: snapshot.status.connection_state || 'offline',
      },
    ]
  }, [snapshot])

  async function handleValidateConfig() {
    setActionPending(true)
    setFlash('')
    setError('')
    try {
      const result = await validateDesktopConfig()
      if (result.valid) {
        setFlash('helper 配置校验通过')
      } else {
        setError(result.error)
      }
      await refreshSnapshot()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '配置校验失败')
    } finally {
      setActionPending(false)
    }
  }

  async function handleSetToken() {
    setActionPending(true)
    setFlash('')
    setError('')
    try {
      await setRuntimeToken(tokenInput)
      setTokenInput('')
      setFlash('runtime token 已写入 helper，本地状态已刷新')
      await refreshSnapshot()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '写入 token 失败')
    } finally {
      setActionPending(false)
    }
  }

  async function handleClearToken() {
    setActionPending(true)
    setFlash('')
    setError('')
    try {
      await clearRuntimeToken()
      setFlash('runtime token 已清除')
      await refreshSnapshot()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '清除 token 失败')
    } finally {
      setActionPending(false)
    }
  }

  async function handleSetAutostart(enabled: boolean) {
    setActionPending(true)
    setFlash('')
    setError('')
    try {
      await setDesktopAutostart(enabled)
      setFlash(enabled ? 'App 登录自启已开启' : 'App 登录自启已关闭')
      await refreshSnapshot()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '更新 App 自启状态失败')
    } finally {
      setActionPending(false)
    }
  }

  async function handleQuitApplication() {
    setActionPending(true)
    setFlash('')
    setError('')
    try {
      await quitDesktopApplication()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '退出 App 失败')
      setActionPending(false)
    }
  }

  const configValidation: ConfigValidation | null = snapshot?.config_validation ?? null

  return (
    <div className="app-shell">
      <div className="background-grid" />
      <main className="app-frame">
        <section className="hero">
          <div>
            <p className="eyebrow">Batch E / macOS App + Helper</p>
            <h1>JARVIS Desktop</h1>
            <p className="hero-copy">
              这版桌面壳负责用户交互和 helper 生命周期；helper 仍保持单条 WS 长连接与 `host.main`
              真实执行面，真正退出 App 时会一起停止。
            </p>
          </div>
          <div className="hero-meta">
            <span className={statusTone(snapshot)}>
              {snapshot?.status.online ? 'Helper 在线' : '等待 Helper 在线'}
            </span>
            <span className={snapshot ? pairingTone(snapshot.status.pairing_state) : 'pill'}>
              {snapshot?.status.pairing_state ?? 'unknown'}
            </span>
            <span className="pill">
              {snapshot ? `Helper ${snapshot.helper_management.mode}` : 'Helper 托管中'}
            </span>
          </div>
        </section>

        <section className="stats-grid">
          {cards.map((card) => (
            <article className="glass-card stat-card" key={card.label}>
              <span className="stat-label">{card.label}</span>
              <strong className="stat-value">{card.value}</strong>
            </article>
          ))}
        </section>

        <section className="content-grid">
          <article className="glass-card">
            <div className="card-header">
              <h2>Helper Snapshot</h2>
              <div className="button-row">
                <button disabled={loading || actionPending} onClick={() => void refreshSnapshot()} type="button">
                  刷新状态
                </button>
                <button disabled={loading || actionPending} onClick={() => void handleValidateConfig()} type="button">
                  校验配置
                </button>
              </div>
            </div>
            {loading ? (
              <p className="muted">正在读取 helper 状态…</p>
            ) : snapshot ? (
              <>
                <dl className="detail-list">
                  <div>
                    <dt>配对状态</dt>
                    <dd>{snapshot.status.pairing_state}</dd>
                  </div>
                  <div>
                    <dt>Has Token</dt>
                    <dd>{snapshot.status.has_runtime_token ? 'yes' : 'no'}</dd>
                  </div>
                  <div>
                    <dt>Config Path</dt>
                    <dd>{snapshot.status.config_path}</dd>
                  </div>
                  <div>
                    <dt>Control Socket</dt>
                    <dd>{snapshot.status.control_socket_path || '未启用'}</dd>
                  </div>
                  <div>
                    <dt>管理模式</dt>
                    <dd>{snapshot.helper_management.mode}</dd>
                  </div>
                  <div>
                    <dt>State Path</dt>
                    <dd>{snapshot.status.state_path}</dd>
                  </div>
                  <div>
                    <dt>Data Root</dt>
                    <dd>{snapshot.helper_management.data_root}</dd>
                  </div>
                  <div>
                    <dt>Helper PID</dt>
                    <dd>{snapshot.status.helper_pid || '未检测到'}</dd>
                  </div>
                  <div>
                    <dt>在线状态</dt>
                    <dd>{snapshot.status.online ? 'online' : 'offline'}</dd>
                  </div>
                  <div>
                    <dt>Hostd Version</dt>
                    <dd>{snapshot.version.version}</dd>
                  </div>
                  <div>
                    <dt>Hostd Binary</dt>
                    <dd>{snapshot.hostd_bin_path || '未解析到'}</dd>
                  </div>
                  <div>
                    <dt>Commit</dt>
                    <dd>{snapshot.version.commit}</dd>
                  </div>
                </dl>
                {snapshot.helper_management.startup_error ? <p className="flash flash-error">{snapshot.helper_management.startup_error}</p> : null}
              </>
            ) : null}
          </article>

          <article className="glass-card">
            <div className="card-header">
              <h2>App Session</h2>
              <span className="micro-note">关闭窗口不会退出应用；如需真正结束会话，请使用这里的退出按钮。</span>
            </div>
            {snapshot ? (
              <>
                <dl className="detail-list">
                  <div>
                    <dt>Close Action</dt>
                    <dd>{snapshot.app_close_action}</dd>
                  </div>
                  <div>
                    <dt>Background Launch</dt>
                    <dd>{snapshot.app_background_launch ? 'yes' : 'no'}</dd>
                  </div>
                  <div>
                    <dt>Login Autostart</dt>
                    <dd>{snapshot.app_autostart.supported ? (snapshot.app_autostart.enabled ? 'enabled' : 'disabled') : 'unsupported'}</dd>
                  </div>
                  <div>
                    <dt>Autostart Entry</dt>
                    <dd>{snapshot.app_autostart.entry_path || '未配置'}</dd>
                  </div>
                  <div>
                    <dt>App Binary</dt>
                    <dd>{snapshot.app_autostart.target_path || '未解析到'}</dd>
                  </div>
                </dl>
                <div className="button-row">
                  <button
                    disabled={actionPending || !snapshot.app_autostart.supported || snapshot.app_autostart.enabled}
                    onClick={() => void handleSetAutostart(true)}
                    type="button"
                  >
                    开启 App 自启
                  </button>
                  <button
                    className="button-muted"
                    disabled={actionPending || !snapshot.app_autostart.supported || !snapshot.app_autostart.enabled}
                    onClick={() => void handleSetAutostart(false)}
                    type="button"
                  >
                    关闭 App 自启
                  </button>
                  <button className="button-muted" disabled={actionPending} onClick={() => void handleQuitApplication()} type="button">
                    退出 App
                  </button>
                </div>
                {snapshot.app_autostart.last_error ? <p className="flash flash-error">{snapshot.app_autostart.last_error}</p> : null}
              </>
            ) : null}
          </article>

          <article className="glass-card">
            <div className="card-header">
              <h2>Token Handoff</h2>
              <span className="micro-note">App 收到 approve 后，通过 Tauri 后端直连 helper 的 control socket，下发 token 并立即触发 reconnect。</span>
            </div>
            <label className="field">
              <span>Runtime Token</span>
              <textarea
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="在这里粘贴 approve 返回的 runtime_token"
                rows={5}
              />
            </label>
            <div className="button-row">
              <button disabled={actionPending || tokenInput.trim() === ''} onClick={() => void handleSetToken()} type="button">
                写入 Token
              </button>
              <button className="button-muted" disabled={actionPending} onClick={() => void handleClearToken()} type="button">
                清除 Token
              </button>
            </div>
            {flash ? <p className="flash flash-success">{flash}</p> : null}
            {error ? <p className="flash flash-error">{error}</p> : null}
          </article>

          <article className="glass-card">
            <div className="card-header">
              <h2>Helper Lifecycle</h2>
              <span className="micro-note">GUI 版本由 App 自己拉起并托管 helper。最小化或隐藏时 helper 继续运行，真正退出 App 时会一起停止。</span>
            </div>
            {snapshot ? (
              <>
                <dl className="detail-list">
                  <div>
                    <dt>Mode</dt>
                    <dd>{snapshot.helper_management.mode}</dd>
                  </div>
                  <div>
                    <dt>Close Behavior</dt>
                    <dd>{snapshot.app_close_action}</dd>
                  </div>
                  <div>
                    <dt>Autostart</dt>
                    <dd>{snapshot.app_autostart.enabled ? 'enabled' : 'disabled'}</dd>
                  </div>
                  <div>
                    <dt>Background Launch</dt>
                    <dd>{snapshot.app_background_launch ? 'yes' : 'no'}</dd>
                  </div>
                  <div>
                    <dt>Helper Available</dt>
                    <dd>{snapshot.status.helper_available ? 'yes' : 'no'}</dd>
                  </div>
                  <div>
                    <dt>True Exit</dt>
                    <dd>stops helper</dd>
                  </div>
                </dl>
                {snapshot.helper_management.startup_error ? <p className="flash flash-error">{snapshot.helper_management.startup_error}</p> : null}
              </>
            ) : null}
          </article>

          <article className="glass-card wide-card">
            <div className="card-header">
              <h2>Config Preview</h2>
              <span className="micro-note">来自 `hostd config validate`，App 不持有比 helper 更权威的 runtime 状态。</span>
            </div>
            {configValidation?.valid ? (
              <div className="config-grid">
                <div>
                  <span className="mini-label">Display Name</span>
                  <strong>{configValidation.config.display_name}</strong>
                </div>
                <div>
                  <span className="mini-label">Gateway URL</span>
                  <strong>{configValidation.config.gateway.ws_url}</strong>
                </div>
                <div>
                  <span className="mini-label">TLS Mode</span>
                  <strong>{configValidation.config.gateway.tls_mode}</strong>
                </div>
                <div>
                  <span className="mini-label">Heartbeat</span>
                  <strong>{configValidation.config.heartbeat_seconds}s</strong>
                </div>
                <div>
                  <span className="mini-label">Host Component</span>
                  <strong>{configValidation.config.components.host.enabled ? 'enabled' : 'disabled'}</strong>
                </div>
                <div>
                  <span className="mini-label">Methods</span>
                  <strong>{configValidation.config.components.host.methods.join(', ')}</strong>
                </div>
              </div>
            ) : (
              <p className="flash flash-error">{configValidation?.error ?? '尚未读取配置'}</p>
            )}
          </article>
        </section>

        <section className="footer-notes">
          <article className="glass-card note-card">
            <h3>Batch E 边界</h3>
            <p>App 负责登录、配对结果展示、状态展示与 helper 生命周期；helper 继续负责 WS 主循环、心跳、重连与 `host.main` 执行。</p>
          </article>
          <article className="glass-card note-card">
            <h3>当前 bridge</h3>
            <p>实时状态和 token 下发走 Tauri Rust 直连 `hostd` control socket；helper 启动由 App 自己管理，配置校验仍调用随 App 分发的 `hostd` 本地命令。</p>
          </article>
        </section>
      </main>
    </div>
  )
}
