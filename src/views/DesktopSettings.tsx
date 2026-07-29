import { Cable, Download, LogIn, LogOut, Power, RefreshCw, Rocket, Save, Unplug } from 'lucide-react'

import { ActionButton, Definition, DefinitionGrid, Panel, StateDot } from '../components/DesktopControls'
import { formatTimestamp } from './format'
import type { DesktopSettingsProps } from './types'

export function DesktopSettings({
  snapshot,
  effectiveAuth,
  actionPending,
  serverUrlInput,
  usernameInput,
  passwordInput,
  clientUpdateProxyInput,
  clientUpdate,
  clientUpdatePending,
  clientUpdateMessage,
  clientUpdateError,
  onServerUrlChange,
  onUsernameChange,
  onPasswordChange,
  onClientUpdateProxyChange,
  onLogin,
  onLogout,
  onBind,
  onReconnect,
  onSetAutostart,
  onCheckClientUpdate,
  onDownloadClientUpdate,
  onInstallClientUpdate,
  onQuitApplication,
}: DesktopSettingsProps) {
  const authenticated = Boolean(effectiveAuth?.authenticated)
  const online = Boolean(snapshot?.status.online)

  return (
    <div className="desktop-view settings-view">
      <section className="settings-status-band">
        <div>
          <span>CONNECTION & SETTINGS</span>
          <h2>{authenticated ? effectiveAuth?.user?.display_name || effectiveAuth?.user?.username : '连接你的控制面'}</h2>
        </div>
        <div className="connection-beacon">
          <StateDot active={online} tone={online ? 'teal' : 'orange'} />
          <strong>{online ? 'Gateway 在线' : 'Gateway 离线'}</strong>
          <span>{snapshot?.status.connection_state || 'offline'}</span>
        </div>
      </section>

      <section className="settings-spatial-grid">
        <Panel className="account-surface" eyebrow="ACCOUNT" title={authenticated ? '账号会话' : '登录'}>
          <label className="desktop-field">
            <span>Server URL</span>
            <input onChange={(event) => onServerUrlChange(event.target.value)} placeholder="https://sunvisai.example.com" type="url" value={serverUrlInput} />
          </label>
          {authenticated ? (
            <>
              <DefinitionGrid>
                <Definition label="账号" value={effectiveAuth?.user?.display_name || effectiveAuth?.user?.username || 'unknown'} />
                <Definition label="角色" value={effectiveAuth?.user?.role || 'unknown'} />
                <Definition label="User ID" value={effectiveAuth?.user?.user_id || 'unknown'} />
                <Definition label="设备绑定" value={snapshot?.status.pairing_state || 'unknown'} />
              </DefinitionGrid>
              <div className="action-row">
                <ActionButton disabled={actionPending || !snapshot?.status.has_runtime_token} icon={Cable} onClick={onReconnect} tone="primary">重新连接</ActionButton>
                <ActionButton disabled={actionPending} icon={RefreshCw} onClick={onBind}>重新绑定</ActionButton>
                <ActionButton disabled={actionPending} icon={LogOut} onClick={onLogout}>退出账号</ActionButton>
              </div>
            </>
          ) : (
            <>
              {effectiveAuth?.bootstrap_init_done === false ? <p className="inline-error" role="alert">服务端尚未初始化，请先在 Web 完成初始化。</p> : null}
              <div className="field-pair">
                <label className="desktop-field">
                  <span>Username</span>
                  <input autoComplete="username" onChange={(event) => onUsernameChange(event.target.value)} type="text" value={usernameInput} />
                </label>
                <label className="desktop-field">
                  <span>Password</span>
                  <input autoComplete="current-password" onChange={(event) => onPasswordChange(event.target.value)} type="password" value={passwordInput} />
                </label>
              </div>
              <ActionButton
                disabled={actionPending || effectiveAuth?.bootstrap_init_done === false || !serverUrlInput.trim() || !usernameInput.trim() || !passwordInput.trim()}
                icon={LogIn}
                onClick={onLogin}
                tone="primary"
              >
                登录并绑定
              </ActionButton>
            </>
          )}
        </Panel>

        <Panel className="connection-surface" eyebrow="RUNTIME LINK" title="设备连接">
          <div className="connection-map">
            <div aria-label={`Account ${authenticated ? '已完成' : '未完成'}`} className={authenticated ? 'is-active' : ''}><span>01</span><strong>Account</strong></div>
            <i />
            <div aria-label={`Token ${snapshot?.status.has_runtime_token ? '已完成' : '未完成'}`} className={snapshot?.status.has_runtime_token ? 'is-active' : ''}><span>02</span><strong>Token</strong></div>
            <i />
            <div aria-label={`Gateway ${online ? '已完成' : '未完成'}`} className={online ? 'is-active' : ''}><span>03</span><strong>Gateway</strong></div>
          </div>
          <DefinitionGrid>
            <Definition label="Runtime" value={snapshot?.status.runtime_id || '未生成'} />
            <Definition label="Gateway" value={snapshot?.status.last_gateway_url || '未配置'} />
            <Definition label="最后连接" value={formatTimestamp(snapshot?.status.last_connected_at)} />
            <Definition label="Bridge" value={snapshot?.status.bridge_mode || snapshot?.bridge || 'unknown'} />
          </DefinitionGrid>
          {snapshot?.status.last_error ? <p className="inline-error" role="alert">{snapshot.status.last_error}</p> : null}
        </Panel>

        <Panel className="update-surface" eyebrow="CLIENT UPDATE" title="客户端更新">
          <label className="desktop-field">
            <span>更新代理 URL</span>
            <input onChange={(event) => onClientUpdateProxyChange(event.target.value)} placeholder="https://proxy.example/{url}" type="url" value={clientUpdateProxyInput} />
          </label>
          <DefinitionGrid>
            <Definition label="当前版本" value={clientUpdate?.current_version || snapshot?.app_version || 'unknown'} />
            <Definition label="最新版本" value={clientUpdate?.latest_version || '尚未检查'} />
            <Definition label="状态" value={clientUpdate ? clientUpdate.update_available ? '发现新版本' : '已是最新' : '未检查'} />
            <Definition label="检查时间" value={formatTimestamp(clientUpdate?.checked_at)} />
          </DefinitionGrid>
          <div className="action-row">
            <ActionButton disabled={clientUpdatePending} icon={RefreshCw} onClick={onCheckClientUpdate}>{clientUpdatePending ? '处理中' : '检查更新'}</ActionButton>
            <ActionButton disabled={clientUpdatePending || !clientUpdate?.asset} icon={Download} onClick={onDownloadClientUpdate}>下载</ActionButton>
            <ActionButton disabled={clientUpdatePending || !clientUpdate?.update_available || !clientUpdate.install_asset} icon={Rocket} onClick={onInstallClientUpdate} tone="primary">安装</ActionButton>
          </div>
          {clientUpdateMessage ? <p className="inline-success" role="status" aria-live="polite">{clientUpdateMessage}</p> : null}
          {clientUpdateError ? <p className="inline-error" role="alert">{clientUpdateError}</p> : null}
        </Panel>

        <Panel className="app-surface" eyebrow="APP LIFECYCLE" title="应用行为">
          <DefinitionGrid>
            <Definition label="关闭窗口" value={snapshot?.app_close_action || 'unknown'} />
            <Definition label="后台启动" value={snapshot?.app_background_launch ? '是' : '否'} />
            <Definition label="登录自启" value={snapshot?.app_autostart.supported ? snapshot.app_autostart.enabled ? '已开启' : '已关闭' : '不支持'} />
            <Definition label="管理模式" value={snapshot?.app_autostart.mode || 'unknown'} />
          </DefinitionGrid>
          <div className="action-row">
            <ActionButton disabled={actionPending || !snapshot?.app_autostart.supported || snapshot.app_autostart.enabled} icon={Save} onClick={() => onSetAutostart(true)}>开启自启</ActionButton>
            <ActionButton disabled={actionPending || !snapshot?.app_autostart.supported || !snapshot.app_autostart.enabled} icon={Unplug} onClick={() => onSetAutostart(false)}>关闭自启</ActionButton>
            <ActionButton disabled={actionPending} icon={Power} onClick={onQuitApplication} tone="danger">退出应用</ActionButton>
          </div>
          {snapshot?.app_autostart.last_error ? <p className="inline-error" role="alert">{snapshot.app_autostart.last_error}</p> : null}
        </Panel>
      </section>
    </div>
  )
}
