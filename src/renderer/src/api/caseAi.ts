const AI_BASE =
  (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_AI_BASE_URL ||
  'http://127.0.0.1:9001'

export interface CaseImage {
  mimeType: string
  base64: string
}

export interface CaseQuestionAnswer {
  questionNo: string
  stem: string
  answer: string
}

export interface CaseSolveResponse {
  title: string
  answerText: string
  questions: CaseQuestionAnswer[]
  raw: string
}

export interface ScoreDimension {
  name: string
  score: number
  max: number
  comment: string
}

export interface CaseScoreResponse {
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

export function parseDataUrl(dataUrl: string): CaseImage | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!m) return null
  return { mimeType: m[1], base64: m[2] }
}

/** 压缩截图，避免多图 JSON 过大 */
export async function compressImageDataUrl(dataUrl: string): Promise<CaseImage> {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) {
    throw new Error('无法解析图片')
  }
  if (parsed.base64.length < 400_000) return parsed

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = dataUrl
  })
  const maxEdge = 1600
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale))
  canvas.height = Math.max(1, Math.round(img.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return parsed
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const out = canvas.toDataURL('image/jpeg', 0.82)
  return parseDataUrl(out) || parsed
}

export function solveCase(payload: {
  subject: string
  title: string
  topicText: string
  images: CaseImage[]
}): Promise<CaseSolveResponse> {
  return postJson('/api/ai/case/solve', payload)
}

export function scoreCase(payload: {
  subject: string
  title: string
  topicText: string
  answerText: string
  images: CaseImage[]
}): Promise<CaseScoreResponse> {
  return postJson('/api/ai/case/score', payload)
}
