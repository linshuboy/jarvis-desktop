export type BuildInfo = {
  version: string
  commit: string
  build_date: string
  go_version: string
}

export type DesktopAuthUser = {
  user_id: string
  username: string
  display_name?: string | null
  role?: string | null
}

export type DesktopAuthState = {
  server_url: string
  authenticated: boolean
  user: DesktopAuthUser | null
}

export type DesktopLoginResult = {
  authenticated: boolean
  bind_succeeded: boolean
  bind_error?: string | null
  auth: DesktopAuthState
}

export type PairStatus = {
  bridge_mode: string
  helper_available: boolean
  config_path: string
  state_path: string
  control_socket_path: string
  runtime_id: string
  pairing_state: string
  has_runtime_token: boolean
  last_gateway_url: string
  last_connected_at: string
  last_error: string
  online: boolean
  connection_state: string
  helper_pid: number
}

export type HostdConfig = {
  gateway: {
    ws_url: string
    tls_mode: string
    tls_fingerprint?: string
  }
  display_name: string
  heartbeat_seconds: number
  components: {
    host: {
      enabled: boolean
      methods: string[]
    }
  }
  logging: {
    level: string
  }
}

export type ConfigValidation =
  | {
      valid: true
      config_path: string
      state_path: string
      config: HostdConfig
    }
  | {
      valid: false
      error: string
    }

export type HelperManagementStatus = {
  mode: string
  data_root: string
  startup_error?: string
}

export type AppAutostartStatus = {
  platform: string
  supported: boolean
  enabled: boolean
  mode: string
  entry_path: string
  target_path: string
  last_error?: string
}

export type DesktopSnapshot = {
  bridge: string
  hostd_bin_path: string
  app_close_action: string
  app_background_launch: boolean
  app_autostart: AppAutostartStatus
  version: BuildInfo
  auth: DesktopAuthState
  status: PairStatus
  config_validation: ConfigValidation
  helper_management: HelperManagementStatus
}
