const AI_BASE =
  (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_AI_BASE_URL ||
  'http://127.0.0.1:9001'

export interface KnowledgeTutorHistoryRecord {
  id: string
  createdAt: number
  subjectId: string
  fileName: string
  topic: string
  markdown: string
  thinking?: string
  role?: 'user' | 'assistant' | string
}

export interface KnowledgeTutorStreamEvent {
  type: 'think_delta' | 'delta' | 'done' | 'error' | string
  delta?: string
  markdown?: string
  thinking?: string
  id?: string
  createdAt?: number
}

export interface KnowledgeTutorStreamChunk {
  type: string
  markdown: string
  thinking: string
}

export function firstMarkdownHeading(md: string): string {
  const m = md.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

export function extractUserQuestion(raw: string): string {
  const text = String(raw || '').trim()
  if (!text) return ''
  const ask = text.lastIndexOf('追问：')
  if (ask >= 0) return text.slice(ask + 3).trim()
  const req = text.indexOf('考生本次要求：')
  if (req >= 0) {
    const rest = text.slice(req + 7).trim()
    const cut = rest.indexOf('\n\n请按系统要求')
    return (cut >= 0 ? rest.slice(0, cut) : rest).trim()
  }
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

export async function listKnowledgeTutorHistory(
  subjectId: string,
  fileName: string,
): Promise<KnowledgeTutorHistoryRecord[]> {
  const params = new URLSearchParams({
    subjectId: subjectId || '',
    fileName: fileName || '',
  })
  const res = await fetch(`${AI_BASE}/api/ai/knowledge/tutor/history?${params}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: string }).message)
        : `请求失败 (${res.status})`
    throw new Error(msg)
  }
  const records = (data as { records?: KnowledgeTutorHistoryRecord[] }).records
  return Array.isArray(records) ? records : []
}

export async function streamKnowledgeTutor(
  payload: {
    subject: string
    subjectId: string
    fileName: string
    title: string
    noteText: string
    question: string
    followUp: boolean
  },
  onChunk: (chunk: KnowledgeTutorStreamChunk) => void,
  signal?: AbortSignal,
): Promise<KnowledgeTutorHistoryRecord> {
  const res = await fetch(`${AI_BASE}/api/ai/knowledge/tutor/stream`, {
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

  const applyEvent = (event: KnowledgeTutorStreamEvent): void => {
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
        throw new Error(event.delta || '辅导生成失败')
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
      applyEvent(JSON.parse(content) as KnowledgeTutorStreamEvent)
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
    topic: firstMarkdownHeading(markdown) || payload.title || payload.question || '',
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
