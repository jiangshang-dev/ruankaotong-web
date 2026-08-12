const AI_BASE =
  (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_AI_BASE_URL ||
  'http://127.0.0.1:9001'

export type PolishPart = 'abstract' | 'body' | 'all'

export interface EssayPolishRequest {
  subject: string
  topic: string
  part: PolishPart
  abstractText: string
  bodyText: string
}

export interface EssayPolishResponse {
  part: string
  abstractText: string
  bodyText: string
  raw: string
}

export interface ScoreDimension {
  name: string
  score: number
  max: number
  comment: string
}

export interface EssayScoreResponse {
  totalScore: number
  level: string
  dimensions: ScoreDimension[]
  summary: string
  strengths: string[]
  improvements: string[]
  raw: string
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AI_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: string }).message)
        : `请求失败 (${res.status})`
    throw new Error(msg)
  }
  return data as T
}

export function polishEssay(payload: EssayPolishRequest): Promise<EssayPolishResponse> {
  return postJson('/api/ai/essay/polish', payload)
}

export function scoreEssay(payload: {
  subject: string
  topic: string
  abstractText: string
  bodyText: string
}): Promise<EssayScoreResponse> {
  return postJson('/api/ai/essay/score', payload)
}
