import type { Subject } from '../data/subjects'

const AI_BASE =
  (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_AI_BASE_URL ||
  'http://127.0.0.1:9001'

export async function listEnabledSubjects(): Promise<Subject[]> {
  try {
    const res = await fetch(`${AI_BASE}/api/subjects`)
    const data = await res.json().catch(() => [])
    if (!res.ok || !Array.isArray(data)) return []
    return data
      .filter((row) => row && typeof row.id === 'string' && typeof row.name === 'string')
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        shortName: String(row.shortName || row.name),
        level: (row.level === '高级' || row.level === '初级' ? row.level : '中级') as Subject['level'],
        color: String(row.color || '#0f766e'),
      }))
  } catch {
    return []
  }
}
