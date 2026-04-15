import { startTransition, useEffect, useMemo, useState } from 'react'

import {
  bindCurrentRuntime,
  getDesktopSnapshot,
  loginDesktop,
  logoutDesktop,
  quitDesktopApplication,
  setDesktopAutostart,
  syncDesktopAuthState,
  validateDesktopConfig,
} from './bridge'
import type { ConfigValidation, DesktopAuthState, DesktopSnapshot } from './types'

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
  const [authState, setAuthState] = useState<DesktopAuthState | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionPending, setActionPending] = useState(false)
  const [autoBindAttemptedFor, setAutoBindAttemptedFor] = useState('')
  const [serverUrlInput, setServerUrlInput] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')

  async function refreshSnapshot() {
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

  useEffect(() => {
    let disposed = false
    syncDesktopAuthState()
      .then((next) => {
        if (disposed) {
          return
        }
        startTransition(() => {
          setAuthState(next)
        })
      })
      .catch(() => {
        return
      })
    return () => {
      disposed = true
    }
  }, [])

  const effectiveAuth = authState ?? snapshot?.auth ?? null
  const autoBindKey =
    effectiveAuth?.authenticated && effectiveAuth.server_url
      ? `${effectiveAuth.server_url}:${effectiveAuth.user?.user_id ?? 'session'}`
      : ''

  useEffect(() => {
    if (effectiveAuth?.server_url && serverUrlInput.trim() === '') {
      setServerUrlInput(effectiveAuth.server_url)
    }
  }, [effectiveAuth?.server_url, serverUrlInput])

  useEffect(() => {
    if (!effectiveAuth?.authenticated) {
      setAutoBindAttemptedFor('')
    }
  }, [effectiveAuth?.authenticated])

  useEffect(() => {
    if (
      snapshot === null ||
      !effectiveAuth?.authenticated ||
      loading ||
      actionPending ||
      autoBindKey === '' ||
      autoBindAttemptedFor === autoBindKey ||
      snapshot.status.has_runtime_token ||
      snapshot.status.pairing_state === 'paired'
    ) {
      return
    }
    let disposed = false
    setAutoBindAttemptedFor(autoBindKey)
    setActionPending(true)
    setFlash('')
    setError('')
    bindCurrentRuntime()
      .then(async () => {
        if (disposed) {
          return
        }
        setFlash('已自动恢复当前设备绑定并写入 helper')
        await refreshSnapshot().catch(() => {
          return
        })
      })
      .catch((nextError) => {
        if (disposed) {
          return
        }
        setError(nextError instanceof Error ? nextError.message : '自动绑定当前设备失败')
      })
      .finally(() => {
        if (disposed) {
          return
        }
        setActionPending(false)
      })
    return () => {
      disposed = true
    }
  }, [actionPending, autoBindAttemptedFor, autoBindKey, effectiveAuth?.authenticated, loading, snapshot])

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
        label: 'Server',
        value: effectiveAuth?.server_url || '未登录',
      },
      {
        label: 'Connection',
        value: snapshot.status.connection_state || 'offline',
      },
    ]
  }, [effectiveAuth?.server_url, snapshot])

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

  async function handleLogin() {
    setActionPending(true)
    setFlash('')
    setError('')
    try {
      const result = await loginDesktop(serverUrlInput, usernameInput, passwordInput)
      setAuthState(result.auth)
      setPasswordInput('')
      if (result.bind_succeeded) {
        setFlash('登录成功，当前设备已自动绑定并写入 helper')
      } else {
        setFlash('登录成功，但当前设备自动绑定失败，可在下方重试')
        if (result.bind_error) {
          setError(result.bind_error)
        }
      }
      await refreshSnapshot()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '登录失败')
    } finally {
      setActionPending(false)
    }
  }

  async function handleBindCurrentRuntime() {
    setActionPending(true)
    setFlash('')
    setError('')
    try {
      await bindCurrentRuntime()
      setFlash('当前设备已重新绑定并刷新 helper token')
      await refreshSnapshot()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '绑定当前设备失败')
    } finally {
      setActionPending(false)
    }
  }

  async function handleLogout() {
    setActionPending(true)
    setFlash('')
    setError('')
    try {
      const result = await logoutDesktop()
      setAuthState(result)
      setFlash('账号已退出，当前设备 token 已清除')
      await refreshSnapshot()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '退出账号失败')
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
  const currentPairingState = snapshot?.status.pairing_state ?? 'unknown'
  const currentPairingLabel =
    currentPairingState === 'paired' ? '已绑定并在线' : snapshot ? `当前状态：${currentPairingState}` : '状态刷新中'

  return (
    <div className="app-shell">
      <div className="background-grid" />
      <main className="app-frame">
        <section className="hero">
          <div>
            <p className="eyebrow">Batch E / macOS App + Helper</p>
            <h1>JARVIS Desktop</h1>
            <p className="hero-copy">
              这版桌面壳负责服务地址配置、账号登录和当前设备自动绑定；helper 仍保持单条 WS 长连接与
              `host.main` 真实执行面，真正退出 App 时会一起停止。
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
              <span className="micro-note">关闭窗口不会退出应用；可通过状态栏或托盘图标重新打开，如需真正结束会话，请使用退出按钮。</span>
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
              <h2>Server & Account</h2>
              <span className="micro-note">GUI 版内部复用 invite create + claim 语义，但不暴露手工链接；用户只需要配置服务地址并登录。</span>
            </div>
            <label className="field">
              <span>Server URL</span>
              <input
                onChange={(event) => setServerUrlInput(event.target.value)}
                placeholder="https://jarvis.example.com"
                type="url"
                value={serverUrlInput}
              />
            </label>
            {effectiveAuth?.authenticated ? (
              <>
                <dl className="detail-list">
                  <div>
                    <dt>当前账号</dt>
                    <dd>{effectiveAuth.user?.display_name || effectiveAuth.user?.username || '未知用户'}</dd>
                  </div>
                  <div>
                    <dt>User ID</dt>
                    <dd>{effectiveAuth.user?.user_id || '未记录'}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{effectiveAuth.user?.role || 'unknown'}</dd>
                  </div>
                  <div>
                    <dt>服务端初始化</dt>
                    <dd>{effectiveAuth.bootstrap_init_done === false ? '未初始化' : '已初始化'}</dd>
                  </div>
                  <div>
                    <dt>设备绑定</dt>
                    <dd>{currentPairingLabel}</dd>
                  </div>
                </dl>
                <div className="button-row">
                  <button disabled={actionPending} onClick={() => void handleBindCurrentRuntime()} type="button">
                    重新绑定当前设备
                  </button>
                  <button className="button-muted" disabled={actionPending} onClick={() => void handleLogout()} type="button">
                    退出账号
                  </button>
                </div>
              </>
            ) : (
              <>
                {effectiveAuth?.bootstrap_init_done === false ? (
                  <p className="flash flash-error">当前服务端尚未初始化。请先在 Web 端完成管理员初始化，再回到桌面端登录。</p>
                ) : null}
                <label className="field">
                  <span>Username</span>
                  <input
                    autoComplete="username"
                    onChange={(event) => setUsernameInput(event.target.value)}
                    placeholder="输入账号名"
                    type="text"
                    value={usernameInput}
                  />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input
                    autoComplete="current-password"
                    onChange={(event) => setPasswordInput(event.target.value)}
                    placeholder="输入密码"
                    type="password"
                    value={passwordInput}
                  />
                </label>
                <div className="button-row">
                  <button
                    disabled={
                      actionPending ||
                      effectiveAuth?.bootstrap_init_done === false ||
                      serverUrlInput.trim() === '' ||
                      usernameInput.trim() === '' ||
                      passwordInput.trim() === ''
                    }
                    onClick={() => void handleLogin()}
                    type="button"
                  >
                    登录并绑定当前设备
                  </button>
                </div>
              </>
            )}
            {effectiveAuth?.auth_error ? <p className="flash flash-error">{effectiveAuth.auth_error}</p> : null}
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
            <p>App 负责服务地址配置、账号登录、当前设备自动绑定、状态展示与 helper 生命周期；helper 继续负责 WS 主循环、心跳、重连与 `host.main` 执行。</p>
          </article>
          <article className="glass-card note-card">
            <h3>当前 bridge</h3>
            <p>GUI 登录后由 Tauri 先创建一次性 invite，再直接调用随 App 分发的 `hostd pair claim-invite` 完成当前设备绑定；helper 启动由 App 自己管理。</p>
          </article>
        </section>
      </main>
    </div>
  )
}
