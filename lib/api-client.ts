const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '')

/** Route API requests directly to Rust on static deployments and through Next rewrites locally. */
export function apiFetch(path: string, init: RequestInit = {}) {
  const url = path.startsWith('/api/') ? `${apiBaseUrl}${path}` : path
  return fetch(url, { ...init, credentials: 'include' })
}
