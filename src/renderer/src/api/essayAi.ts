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

export interface EssayImage {
  mimeType: string
  base64: string
}

export interface EssayGuideSection {
  name: string
  words: string
  content: string
}

export interface EssayProjectExample {
  name: string
  industry: string
  company: string
  role: string
  period: string
  background: string
  modules: string
  techChoice: string
  effects: string
  story: string
}

export interface EssayGuideResponse {
  recognizedTopic: string
  subQuestions: string[]
  coreArguments: string[]
  timePlan: string
  framework: EssayGuideSection[]
  tips: string[]
  pitfalls: string[]
  project: EssayProjectExample
  abstractDraft: string
  bodyOutline: string
  raw: string
}

export function guideEssay(payload: {
  subject: string
  topic: string
  abstractText: string
  bodyText: string
  images: EssayImage[]
}): Promise<EssayGuideResponse> {
  return postJson('/api/ai/essay/guide', payload)
}

export interface EssayGuideRecord {
  id: string
  createdAt: number
  guide: EssayGuideResponse
}

export function stripGuideRaw(guide: EssayGuideResponse): EssayGuideResponse {
  return { ...guide, raw: '' }
}

export interface EssayGuideHistoryRecord {
  id: string
  createdAt: number
  subjectId: string
  fileName: string
  topic: string
  markdown: string
  thinking?: string
}

export interface EssayGuideStreamEvent {
  type: 'think_delta' | 'delta' | 'done' | 'error' | string
  delta?: string
  markdown?: string
  thinking?: string
  id?: string
  createdAt?: number
}

export interface EssayGuideStreamChunk {
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

export async function listEssayGuideHistory(
  subjectId: string,
  fileName: string,
): Promise<EssayGuideHistoryRecord[]> {
  const params = new URLSearchParams({
    subjectId: subjectId || '',
    fileName: fileName || '',
  })
  const res = await fetch(`${AI_BASE}/api/ai/essay/guide/history?${params}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: string }).message)
        : `请求失败 (${res.status})`
    throw new Error(msg)
  }
  const records = (data as { records?: EssayGuideHistoryRecord[] }).records
  return Array.isArray(records) ? records : []
}

export async function streamEssayGuide(
  payload: {
    subject: string
    subjectId: string
    fileName: string
    topic: string
    abstractText: string
    bodyText: string
    images: EssayImage[]
  },
  onChunk: (chunk: EssayGuideStreamChunk) => void,
  signal?: AbortSignal,
): Promise<EssayGuideHistoryRecord> {
  const res = await fetch(`${AI_BASE}/api/ai/essay/guide/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: string }).message)
        : `请求失败 (${res.status})`
    throw new Error(msg)
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

  const applyEvent = (event: EssayGuideStreamEvent): void => {
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
        throw new Error(event.delta || '指导生成失败')
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
      let content = line.replace(/^data:\s*/, '').trim()
      if (!content || content === '[DONE]') continue
      if (!isCompleteJsonObject(content)) {
        buffer = line
        continue
      }
      buffer = ''
      applyEvent(JSON.parse(content) as EssayGuideStreamEvent)
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
    topic: firstMarkdownHeading(markdown) || payload.topic.split('\n')[0] || '',
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
