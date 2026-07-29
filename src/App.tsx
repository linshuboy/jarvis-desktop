import { startTransition, useEffect, useMemo, useState } from 'react'
import { Activity, LayoutDashboard, RefreshCw, Settings2, Sparkles } from 'lucide-react'
import { SpatialAppShell, type SpatialNavItem } from '@agi/frontend/web'

import {
  bindCurrentRuntime,
  checkDesktopClientUpdate,
  downloadDesktopClientUpdate,
  getDesktopSnapshot,
  installDesktopClientUpdate,
  loginDesktop,
  logoutDesktop,
  quitDesktopApplication,
  reconnectRuntime,
  setDesktopAutostart,
  syncDesktopAuthState,
  validateDesktopConfig,
} from './bridge'
import { IconButton, StateDot } from './components/DesktopControls'
import { readStoredUpdateProxyUrl, writeStoredUpdateProxyUrl } from './clientUpdates'
import { createDesktopRuntimeProcessView } from './desktopStatusAdapter'
import { DesktopOverview } from './views/DesktopOverview'
import { DesktopRuntime } from './views/DesktopRuntime'
import { DesktopSettings } from './views/DesktopSettings'
import type { ConfigValidation, DesktopAuthState, DesktopClientUpdateCheck, DesktopSnapshot } from './types'

type DesktopViewId = 'overview' | 'runtime' | 'settings'

const navigation: SpatialNavItem[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'runtime', label: '运行时', icon: Activity },
  { id: 'settings', label: '连接与设置', icon: Settings2 },
]

const viewMeta: Record<DesktopViewId, { title: string; context: string }> = {
  overview: { title: '自治总览', context: '运行环境、证据与下一动作' },
  runtime: { title: '运行时', context: 'Helper、Gateway 与设备执行边界' },
  settings: { title: '连接与设置', context: '账号、绑定、更新与应用生命周期' },
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

export default function App() {
  const [activeView, setActiveView] = useState<DesktopViewId>('overview')
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
  const [clientUpdate, setClientUpdate] = useState<DesktopClientUpdateCheck | null>(null)
  const [clientUpdatePending, setClientUpdatePending] = useState(false)
  const [clientUpdateMessage, setClientUpdateMessage] = useState('')
  const [clientUpdateError, setClientUpdateError] = useState('')
  const [clientUpdateProxyInput, setClientUpdateProxyInput] = useState(() => readStoredUpdateProxyUrl())
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
      if (!disposed) {
        setError(describeError(nextError, '加载桌面状态失败'))
        setLoading(false)
      }
    })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    let disposed = false
    syncDesktopAuthState()
      .then((next) => {
        if (!disposed) startTransition(() => setAuthState(next))
      })
      .catch(() => undefined)
    return () => { disposed = true }
  }, [])

  const effectiveAuth = authState ?? snapshot?.auth ?? null
  const autoBindKey = effectiveAuth?.authenticated && effectiveAuth.server_url
    ? `${effectiveAuth.server_url}:${effectiveAuth.user?.user_id ?? 'session'}`
    : ''

  useEffect(() => {
    if (effectiveAuth?.server_url && serverUrlInput.trim() === '') {
      setServerUrlInput(effectiveAuth.server_url)
    }
  }, [effectiveAuth?.server_url, serverUrlInput])

  useEffect(() => {
    if (!effectiveAuth?.authenticated) setAutoBindAttemptedFor('')
  }, [effectiveAuth?.authenticated])

  useEffect(() => {
    if (
      snapshot === null || !effectiveAuth?.authenticated || loading || actionPending || !autoBindKey
      || autoBindAttemptedFor === autoBindKey || snapshot.status.has_runtime_token || snapshot.status.pairing_state === 'paired'
    ) return

    let disposed = false
    setAutoBindAttemptedFor(autoBindKey)
    setActionPending(true)
    setFlash('')
    setError('')
    bindCurrentRuntime()
      .then(async () => {
        if (disposed) return
        setFlash('当前设备已自动恢复绑定')
        await refreshSnapshot().catch(() => undefined)
      })
      .catch((nextError) => {
        if (!disposed) setError(describeError(nextError, '自动绑定当前设备失败'))
      })
      .finally(() => {
        if (!disposed) setActionPending(false)
      })
    return () => { disposed = true }
  }, [actionPending, autoBindAttemptedFor, autoBindKey, effectiveAuth?.authenticated, loading, snapshot])

  const runAction = async (action: () => Promise<unknown>, success: string, fallback: string, refresh = true) => {
    setActionPending(true)
    setFlash('')
    setError('')
    try {
      await action()
      setFlash(success)
      if (refresh) await refreshSnapshot()
    } catch (nextError) {
      setError(describeError(nextError, fallback))
    } finally {
      setActionPending(false)
    }
  }

  async function handleValidateConfig() {
    setActionPending(true)
    setFlash('')
    setError('')
    try {
      const result = await validateDesktopConfig()
      result.valid ? setFlash('Helper 配置校验通过') : setError(result.error)
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
      setFlash(result.bind_succeeded ? '登录成功，当前设备已自动绑定' : '登录成功，设备等待重新绑定')
      if (!result.bind_succeeded) setError(result.bind_error?.trim() || '当前设备自动绑定失败')
      await refreshSnapshot()
    } catch (nextError) {
      setError(describeError(nextError, '登录失败'))
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
      setFlash('账号已退出，当前设备 Token 已清除')
      await refreshSnapshot()
    } catch (nextError) {
      setError(describeError(nextError, '退出账号失败'))
    } finally {
      setActionPending(false)
    }
  }

  async function handleCheckClientUpdate() {
    const proxyUrl = clientUpdateProxyInput.trim()
    writeStoredUpdateProxyUrl(proxyUrl)
    setClientUpdatePending(true)
    setClientUpdateMessage('')
    setClientUpdateError('')
    try {
      const result = await checkDesktopClientUpdate(proxyUrl)
      setClientUpdate(result)
      setClientUpdateMessage(result.update_available ? `发现新版本 ${result.latest_version}` : '当前已是最新版本')
    } catch (nextError) {
      setClientUpdateError(describeError(nextError, '检查客户端更新失败'))
    } finally {
      setClientUpdatePending(false)
    }
  }

  async function handleDownloadClientUpdate() {
    const proxyUrl = clientUpdateProxyInput.trim()
    writeStoredUpdateProxyUrl(proxyUrl)
    setClientUpdatePending(true)
    setClientUpdateMessage('')
    setClientUpdateError('')
    try {
      const result = await downloadDesktopClientUpdate(proxyUrl)
      setClientUpdateMessage(`客户端安装包已下载到 ${result.download_path}`)
    } catch (nextError) {
      setClientUpdateError(describeError(nextError, '下载客户端安装包失败'))
    } finally {
      setClientUpdatePending(false)
    }
  }

  async function handleInstallClientUpdate() {
    const proxyUrl = clientUpdateProxyInput.trim()
    writeStoredUpdateProxyUrl(proxyUrl)
    setClientUpdatePending(true)
    setClientUpdateMessage('')
    setClientUpdateError('')
    try {
      const result = await installDesktopClientUpdate(proxyUrl)
      setClientUpdateMessage(`安装器已启动：${result.target_app_path}`)
    } catch (nextError) {
      setClientUpdateError(describeError(nextError, '安装客户端更新失败'))
      setClientUpdatePending(false)
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

  const configValidation: ConfigValidation | null = snapshot?.config_validation ?? null
  const runtimeProcessView = useMemo(
    () => createDesktopRuntimeProcessView({ snapshot, effectiveAuth, configValidation }),
    [configValidation, effectiveAuth, snapshot],
  )
  const meta = viewMeta[activeView]

  const content = activeView === 'overview' ? (
    <DesktopOverview
      actionPending={actionPending}
      effectiveAuth={effectiveAuth}
      loading={loading}
      onOpenRuntime={() => setActiveView('runtime')}
      onRefresh={() => void refreshSnapshot()}
      runtimeProcessView={runtimeProcessView}
      snapshot={snapshot}
    />
  ) : activeView === 'runtime' ? (
    <DesktopRuntime
      actionPending={actionPending}
      configValidation={configValidation}
      effectiveAuth={effectiveAuth}
      loading={loading}
      onBind={() => void runAction(bindCurrentRuntime, '当前设备已重新绑定', '绑定当前设备失败')}
      onReconnect={() => void runAction(reconnectRuntime, '已请求 Helper 重新连接 Gateway', '重新连接失败')}
      onRefresh={() => void refreshSnapshot()}
      onValidate={() => void handleValidateConfig()}
      runtimeProcessView={runtimeProcessView}
      snapshot={snapshot}
    />
  ) : (
    <DesktopSettings
      actionPending={actionPending}
      clientUpdate={clientUpdate}
      clientUpdateError={clientUpdateError}
      clientUpdateMessage={clientUpdateMessage}
      clientUpdatePending={clientUpdatePending}
      clientUpdateProxyInput={clientUpdateProxyInput}
      effectiveAuth={effectiveAuth}
      loading={loading}
      onBind={() => void runAction(bindCurrentRuntime, '当前设备已重新绑定', '绑定当前设备失败')}
      onCheckClientUpdate={() => void handleCheckClientUpdate()}
      onClientUpdateProxyChange={setClientUpdateProxyInput}
      onDownloadClientUpdate={() => void handleDownloadClientUpdate()}
      onInstallClientUpdate={() => void handleInstallClientUpdate()}
      onLogin={() => void handleLogin()}
      onLogout={() => void handleLogout()}
      onPasswordChange={setPasswordInput}
      onQuitApplication={() => void handleQuitApplication()}
      onReconnect={() => void runAction(reconnectRuntime, '已请求 Helper 重新连接 Gateway', '重新连接失败')}
      onServerUrlChange={setServerUrlInput}
      onSetAutostart={(enabled) => void runAction(() => setDesktopAutostart(enabled), enabled ? '登录自启已开启' : '登录自启已关闭', '更新登录自启失败')}
      onUsernameChange={setUsernameInput}
      passwordInput={passwordInput}
      serverUrlInput={serverUrlInput}
      snapshot={snapshot}
      usernameInput={usernameInput}
    />
  )

  return (
    <SpatialAppShell
      activeNavigationId={activeView}
      actions={<IconButton disabled={loading || actionPending} icon={RefreshCw} label="刷新状态" onClick={() => void refreshSnapshot()} />}
      brand={<div className="desktop-brand"><Sparkles aria-hidden="true" size={18} /><span>Sunvisai</span></div>}
      className="desktop-app-shell"
      context={meta.context}
      navigation={navigation}
      onNavigate={(id: string) => setActiveView(id as DesktopViewId)}
      railFooter={(
        <div className="rail-runtime-state">
          <StateDot active={Boolean(snapshot?.status.online)} tone={snapshot?.status.online ? 'teal' : 'orange'} />
          <div><strong>{snapshot?.status.online ? 'Online' : 'Offline'}</strong><span>{snapshot?.status.bridge_mode || 'loading'}</span></div>
        </div>
      )}
      status={<span className="header-runtime-status"><StateDot active={Boolean(snapshot?.status.online)} tone={snapshot?.status.online ? 'teal' : 'orange'} />{snapshot?.status.connection_state || 'loading'}</span>}
      title={meta.title}
    >
      {flash ? <div className="global-notice global-notice--success" role="status" aria-live="polite">{flash}</div> : null}
      {error ? <div className="global-notice global-notice--error" role="alert">{error}</div> : null}
      {content}
    </SpatialAppShell>
  )
}
