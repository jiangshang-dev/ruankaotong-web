import { AI_BASE, authHeaders, readApiError, throwIfAiAuthFailed } from './auth'

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
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  await throwIfAiAuthFailed(res)
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
  subjectId?: string
  fileName?: string
}): Promise<CaseScoreResponse> {
  return postJson('/api/ai/case/score', payload)
}

export interface CaseExplainHistoryRecord {
  id: string
  createdAt: number
  subjectId: string
  fileName: string
  topic: string
  markdown: string
  thinking?: string
}

export interface CaseExplainStreamEvent {
  type: 'think_delta' | 'delta' | 'done' | 'error' | string
  delta?: string
  markdown?: string
  thinking?: string
  id?: string
  createdAt?: number
}

export interface CaseExplainStreamChunk {
  type: string
  markdown: string
  thinking: string
}

export function firstMarkdownHeading(md: string): string {
  const m = md.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

export function extractMarkdownSection(md: string, title: string): string {
  if (!md) return ''
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^#{1,3}\\s*${escaped}\\s*$\\n([\\s\\S]*?)(?=^#{1,3}\\s+|$)`, 'm')
  const m = md.match(re)
  return m ? m[1].trim() : ''
}

export async function listCaseExplainHistory(
  subjectId: string,
  fileName: string,
): Promise<CaseExplainHistoryRecord[]> {
  const params = new URLSearchParams({
    subjectId: subjectId || '',
    fileName: fileName || '',
  })
  const res = await fetch(`${AI_BASE}/api/ai/case/explain/history?${params}`, {
    headers: authHeaders(),
  })
  await throwIfAiAuthFailed(res)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: string }).message)
        : `请求失败 (${res.status})`
    throw new Error(msg)
  }
  const records = (data as { records?: CaseExplainHistoryRecord[] }).records
  return Array.isArray(records) ? records : []
}

export async function streamCaseExplain(
  payload: {
    subject: string
    subjectId: string
    fileName: string
    title: string
    topicText: string
    answerText: string
    images: CaseImage[]
  },
  onChunk: (chunk: CaseExplainStreamChunk) => void,
  signal?: AbortSignal,
): Promise<CaseExplainHistoryRecord> {
  const res = await fetch(`${AI_BASE}/api/ai/case/explain/stream`, {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }),
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok) {
    await throwIfAiAuthFailed(res)
    throw new Error(await readApiError(res))
  }
  const readableStream = res.body
  if (!(readableStream instanceof ReadableStream)) {
    throw new Error('响应的不是流')
  }

  let markdown = ''
  let thinking = ''
  let recordId = `${Date.now()}`
  let createdAt = Date.now()
  const reader = readableStream.getReader()
  const decoder = new TextDecoder('UTF-8')
  let buffer = ''

  const emitChunk = (type: string): void => {
    onChunk({ type, markdown, thinking })
  }

  const applyEvent = (event: CaseExplainStreamEvent): void => {
    if (event.id) recordId = event.id
    if (event.createdAt) createdAt = event.createdAt
    if (event.type === 'think_delta') {
      thinking = event.thinking || thinking + (event.delta || '')
      emitChunk('think_delta')
      return
    }
    if (event.type === 'delta') {
      markdown = event.markdown || markdown + (event.delta || '')
      if (event.thinking) thinking = event.thinking
      emitChunk('delta')
      return
    }
    if (event.type === 'done' || event.type === 'error') {
      if (event.markdown) markdown = event.markdown
      if (event.thinking) thinking = event.thinking
      emitChunk(event.type)
      if (event.type === 'error') {
        throw new Error(event.delta || '讲解生成失败')
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    let result = decoder.decode(value, { stream: true })
    result = buffer + result
    const lines = result.split('\n\n')
    for (const line of lines) {
      if (!line.startsWith('data:')) {
        continue
      }
      const content = line.replace(/^data:\s*/, '').trim()
      if (!content || content === '[DONE]') continue
      if (!isCompleteJsonObject(content)) {
        buffer = line
        continue
      }
      buffer = ''
      applyEvent(JSON.parse(content) as CaseExplainStreamEvent)
    }
    if (!result.endsWith('\n\n')) {
      const last = lines[lines.length - 1] || ''
      if (last && !isCompleteJsonObject(last.replace(/^data:\s*/, '').trim())) {
        buffer = last
      }
    }
  }

  return {
    id: recordId,
    createdAt,
    subjectId: payload.subjectId,
    fileName: payload.fileName,
    topic: firstMarkdownHeading(markdown) || payload.title || '',
    markdown,
    thinking,
  }
}

function isCompleteJsonObject(text: string): boolean {
  if (!text || text[0] !== '{') return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}
