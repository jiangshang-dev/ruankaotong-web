const AI_BASE =
  (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_AI_BASE_URL ||
  'http://127.0.0.1:9001'

const TOKEN_KEY = 'ruankao.client.token'
const EMAIL_KEY = 'ruankao.client.email'
const NAME_KEY = 'ruankao.client.name'

export class AuthRequiredError extends Error {
  constructor(message = '请先登录后再使用 AI') {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

export class AccountDisabledError extends Error {
  constructor(message = '账号已禁用，请联系管理员') {
    super(message)
    this.name = 'AccountDisabledError'
  }
}

export function getClientToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function getClientEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) || ''
  } catch {
    return ''
  }
}

export function getClientName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || ''
  } catch {
    return ''
  }
}

export function saveClientAuth(token: string, email: string, name = ''): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(EMAIL_KEY, email)
  if (name) localStorage.setItem(NAME_KEY, name)
}

export function clearClientAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(EMAIL_KEY)
  localStorage.removeItem(NAME_KEY)
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getClientToken()
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra }
}

export async function readApiError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}))
  if (typeof data === 'object' && data && 'message' in data) {
    return String((data as { message: string }).message)
  }
  return `请求失败 (${res.status})`
}

export async function throwIfAiAuthFailed(res: Response): Promise<void> {
  if (res.status === 401) throw new AuthRequiredError(await readApiError(res))
  if (res.status === 403) throw new AccountDisabledError(await readApiError(res))
}

export async function sendEmailCode(email: string): Promise<void> {
  const res = await fetch(`${AI_BASE}/api/auth/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(await readApiError(res))
}

export async function loginByEmail(email: string, code: string): Promise<{ token: string; email: string; name: string }> {
  const res = await fetch(`${AI_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json()
}

export async function fetchClientMe(): Promise<{ email: string; name: string } | null> {
  const token = getClientToken()
  if (!token) return null
  const res = await fetch(`${AI_BASE}/api/auth/me`, {
    headers: authHeaders(),
  })
  if (!res.ok) return null
  return res.json()
}

export async function updateClientProfile(name: string): Promise<{ email: string; name: string }> {
  const res = await fetch(`${AI_BASE}/api/auth/profile`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json()
}

export async function logoutClient(): Promise<void> {
  try {
    await fetch(`${AI_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: authHeaders(),
    })
  } catch {
    // ignore
  }
  clearClientAuth()
}

export { AI_BASE }
