import { startTransition, useEffect, useMemo, useState } from 'react'
import {
  DigitalHumanPanel,
  ProcessTimeline,
  RoleMarker,
  StatusPill,
  WorkbenchShell,
  createInitialDigitalHumanVisualState,
  createDigitalHumanStatusSummary,
  runDigitalHumanKernelTask,
  type AvatarVisualState,
  type RunKernelTaskArguments,
} from '@agi/frontend'

import {
  bindCurrentRuntime,
  getDesktopSnapshot,
  loginDesktop,
  logoutDesktop,
  quitDesktopApplication,
  reconnectRuntime,
  setDesktopAutostart,
  syncDesktopAuthState,
  validateDesktopConfig,
} from './bridge'
import { createDesktopRuntimeProcessView } from './desktopStatusAdapter'
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

function describeError(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim()) {
    return value.message
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  return fallback
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
  const [digitalHumanMode, setDigitalHumanMode] = useState(false)
  const [digitalHumanSessionActive, setDigitalHumanSessionActive] = useState(false)
  const [digitalHumanVisualState, setDigitalHumanVisualState] = useState<AvatarVisualState>(() =>
    createInitialDigitalHumanVisualState(),
  )

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
      setError(describeError(nextError, '加载桌面状态失败'))
      setLoading(false)
    })
    return () => {
      disposed = true
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
        setError(describeError(nextError, '自动绑定当前设备失败'))
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
        label: '设备 ID',
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
      setError(describeError(nextError, '配置校验失败'))
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
      let bindError = ''
      if (result.bind_succeeded) {
        setFlash('登录成功，当前设备已自动绑定并写入 helper')
      } else {
        setFlash('登录成功，但当前设备自动绑定失败，可在下方重试')
        bindError = result.bind_error?.trim() || '当前设备自动绑定失败'
        setError(bindError)
      }
      try {
        await refreshSnapshot()
      } catch (snapshotError) {
        const snapshotMessage = describeError(snapshotError, '登录后刷新本机 helper 状态失败')
        setError(
          bindError
            ? `${bindError}\n状态刷新失败：${snapshotMessage}`
            : `登录成功，但刷新本机 helper 状态失败：${snapshotMessage}`,
        )
      }
    } catch (nextError) {
      setError(describeError(nextError, '登录失败'))
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
      setError(describeError(nextError, '绑定当前设备失败'))
    } finally {
      setActionPending(false)
    }
  }

  async function handleReconnectRuntime() {
    setActionPending(true)
    setFlash('')
    setError('')
    try {
      await reconnectRuntime()
      setFlash('已请求 helper 重新连接 Gateway')
      await refreshSnapshot()
    } catch (nextError) {
      setError(describeError(nextError, '重新连接失败'))
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
      setError(describeError(nextError, '退出账号失败'))
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
      setError(describeError(nextError, '更新 App 自启状态失败'))
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
      setError(describeError(nextError, '退出 App 失败'))
      setActionPending(false)
    }
  }

  function startDigitalHumanVoiceSession() {
    setDigitalHumanMode(true)
    setDigitalHumanSessionActive(true)
    setDigitalHumanVisualState({
      state: 'listening',
      source: 'realtime',
      message: '桌面数字人已就绪，可配合 Web 对话活动使用',
      at: new Date().toISOString(),
    })
  }

  function interruptDigitalHumanVoiceSession() {
    setDigitalHumanSessionActive(false)
    setDigitalHumanVisualState({
      state: 'interrupted',
      source: 'realtime',
      message: '已打断数字人播报',
      at: new Date().toISOString(),
    })
  }

  async function runDigitalHumanKernelTaskFromDesktop(args: RunKernelTaskArguments) {
    return await runDigitalHumanKernelTask(
      args,
      { sessionId: 'desktop-digital-human' },
      {
        async sendActivityThreadMessage() {
          return {
            error: {
              code: 'ACTIVITY_THREAD_REQUIRED',
              message: '桌面端需要先连接到一个活动线程',
            },
            requiresUserAction: true,
          }
        },
      },
    )
  }

  const configValidation: ConfigValidation | null = snapshot?.config_validation ?? null
  const currentPairingState = snapshot?.status.pairing_state ?? 'unknown'
  const currentPairingLabel =
    currentPairingState === 'paired' ? '已绑定并在线' : snapshot ? `当前状态：${currentPairingState}` : '状态刷新中'
  const runtimeProcessView = useMemo(
    () => createDesktopRuntimeProcessView({ snapshot, effectiveAuth, configValidation }),
    [configValidation, effectiveAuth, snapshot],
  )

  const workbenchRail = (
    <div className="desktop-rail">
      <div className="rail-cluster">
        <span className="rail-label">Runtime</span>
        <strong>{snapshot?.status.runtime_id || '尚未生成'}</strong>
      </div>
      <div className="rail-cluster">
        <span className="rail-label">Gateway</span>
        <strong>{snapshot?.status.last_gateway_url || effectiveAuth?.server_url || '未配置'}</strong>
      </div>
      <div className="rail-cluster">
        <span className="rail-label">Bridge</span>
        <strong>{snapshot?.status.bridge_mode || snapshot?.bridge || 'loading'}</strong>
      </div>
    </div>
  )

  return (
    <div className="app-shell">
      <div className="background-grid" />
      <main className="app-frame desktop-redesign">
        <section className="hero">
          <div>
            <p className="eyebrow">Desktop Runtime Console</p>
            <h1>Sunvisai Desktop</h1>
            <p className="hero-copy">
              桌面端前端壳已重设计为高密度工作台。App 只负责登录、绑定、状态和 helper 生命周期；真正的
              `host.*` 执行仍由 hostd 承载。
            </p>
          </div>
          <div className="hero-meta">
            <RoleMarker role="machine" />
            <span className={statusTone(snapshot)}>
              {snapshot?.status.online ? 'Helper 在线' : '等待 Helper 在线'}
            </span>
            <StatusPill status={snapshot?.status.online ? 'running' : snapshot?.status.last_error ? 'failed' : 'waiting'} />
            {createDigitalHumanStatusSummary(digitalHumanVisualState)}
            <span className={snapshot ? pairingTone(snapshot.status.pairing_state) : 'pill'}>
              {snapshot?.status.pairing_state ?? 'unknown'}
            </span>
            <button className="hero-action" type="button" onClick={() => setDigitalHumanMode((prev) => !prev)}>
              {digitalHumanMode ? '隐藏数字人' : '数字人模式'}
            </button>
          </div>
        </section>

        <WorkbenchShell title="运行时总览" subtitle="登录、绑定、helper 和执行面状态归一展示" rail={workbenchRail}>
        {digitalHumanMode ? (
          <DigitalHumanPanel
            visualState={digitalHumanVisualState}
            sessionActive={digitalHumanSessionActive}
            onStartVoice={startDigitalHumanVoiceSession}
            onInterrupt={interruptDigitalHumanVoiceSession}
          />
        ) : null}
        <section className="stats-grid">
          {cards.map((card) => (
            <article className="glass-card stat-card" key={card.label}>
              <span className="stat-label">{card.label}</span>
              <strong className="stat-value">{card.value}</strong>
            </article>
          ))}
        </section>
        <section className="desktop-process-summary">
          <div className="card-header">
            <h2>执行面过程摘要</h2>
            <span className="micro-note">由共享 AgentProcessView 合成</span>
          </div>
          <ProcessTimeline view={runtimeProcessView} />
        </section>
        </WorkbenchShell>

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
                    <dt>设备 Token</dt>
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
                {snapshot.version.error ? <p className="flash flash-error">hostd version：{snapshot.version.error}</p> : null}
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
                placeholder="https://sunvisai.example.com"
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
                  <button
                    disabled={actionPending || !snapshot?.status.has_runtime_token}
                    onClick={() => void handleReconnectRuntime()}
                    type="button"
                  >
                    重新连接
                  </button>
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
              <span className="micro-note">来自 `hostd config validate`，App 不持有比 helper 更权威的设备状态。</span>
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
