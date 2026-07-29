export function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '未记录'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function shortIdentity(value: string | null | undefined, fallback = '未生成'): string {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return fallback
  }
  return normalized.length > 20 ? `${normalized.slice(0, 10)}...${normalized.slice(-6)}` : normalized
}
