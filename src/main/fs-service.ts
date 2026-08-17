import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, statSync } from 'fs'
import { join, basename } from 'path'

export type NoteKind = 'notes' | 'essays' | 'cases'

export interface AppConfig {
  rootPath: string
  lastSubjectId: string
}

export interface NoteMeta {
  fileName: string
  title: string
  kind: NoteKind
  updatedAt: number
  size: number
}

export interface NoteContent {
  fileName: string
  title: string
  content: string
  updatedAt: number
}

const CONFIG_FILE = 'ruankaotong-config.json'

function safeName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function getAppConfig(userDataPath: string): AppConfig {
  const file = join(userDataPath, CONFIG_FILE)
  if (!existsSync(file)) {
    return { rootPath: '', lastSubjectId: 'architect' }
  }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<AppConfig>
    return {
      rootPath: raw.rootPath || '',
      lastSubjectId: raw.lastSubjectId || 'architect',
    }
  } catch {
    return { rootPath: '', lastSubjectId: 'architect' }
  }
}

export function saveAppConfig(userDataPath: string, config: AppConfig): AppConfig {
  ensureDir(userDataPath)
  const file = join(userDataPath, CONFIG_FILE)
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf-8')
  return config
}

export function ensureSubjectDirs(rootPath: string, subjectId: string): void {
  ensureDir(join(rootPath, subjectId, 'notes'))
  ensureDir(join(rootPath, subjectId, 'essays'))
  ensureDir(join(rootPath, subjectId, 'cases'))
  ensureDir(join(rootPath, subjectId, 'notes', 'assets'))
  ensureDir(join(rootPath, subjectId, 'essays', 'assets'))
  ensureDir(join(rootPath, subjectId, 'cases', 'assets'))
  ensureDir(join(rootPath, subjectId, 'essays', '.guides'))
}

export interface SavedImage {
  relativePath: string
  dataUrl: string
  fileName: string
}

function extFromMime(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  return 'png'
}

/** 将剪贴板/粘贴的图片写入科目 assets 目录 */
export function saveNoteImage(payload: {
  rootPath: string
  subjectId: string
  kind: NoteKind
  bytes: Uint8Array | Buffer
  mimeType?: string
}): SavedImage {
  const { rootPath, subjectId, kind, mimeType = 'image/png' } = payload
  ensureSubjectDirs(rootPath, subjectId)
  const ext = extFromMime(mimeType)
  const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const relativePath = `assets/${fileName}`
  const full = join(rootPath, subjectId, kind, relativePath)
  const buf = Buffer.from(payload.bytes)
  writeFileSync(full, buf)
  const dataUrl = `data:${mimeType};base64,${buf.toString('base64')}`
  return { relativePath, dataUrl, fileName }
}

/** 读取笔记相对路径图片为 data URL（用于编辑器回显） */
export function readNoteImageDataUrl(payload: {
  rootPath: string
  subjectId: string
  kind: NoteKind
  relativePath: string
}): string | null {
  const rel = payload.relativePath.replace(/^(\.\/)+/, '').replace(/\\/g, '/')
  if (!rel.startsWith('assets/') || rel.includes('..')) return null
  const full = join(payload.rootPath, payload.subjectId, payload.kind, rel)
  if (!existsSync(full)) return null
  const buf = readFileSync(full)
  const lower = rel.toLowerCase()
  const mime = lower.endsWith('.jpg') || lower.endsWith('.jpeg')
    ? 'image/jpeg'
    : lower.endsWith('.webp')
      ? 'image/webp'
      : lower.endsWith('.gif')
        ? 'image/gif'
        : 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

function parseTitle(content: string, fileName: string): string {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (fm) {
    const titleLine = fm[1].match(/^title:\s*(.+)$/m)
    if (titleLine) return titleLine[1].trim().replace(/^["']|["']$/g, '')
  }
  const h1 = content.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  return basename(fileName, '.md')
}

/** 列表自定义排序（拖动排序持久化） */
const ORDER_FILE = '.order.json'

function orderFilePath(
  rootPath: string,
  subjectId: string,
  kind: NoteKind,
): string {
  return join(rootPath, subjectId, kind, ORDER_FILE)
}

function readOrder(
  rootPath: string,
  subjectId: string,
  kind: NoteKind,
): string[] {
  const file = orderFilePath(rootPath, subjectId, kind)
  if (!existsSync(file)) return []
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function writeOrder(
  rootPath: string,
  subjectId: string,
  kind: NoteKind,
  fileNames: string[],
): void {
  ensureDir(join(rootPath, subjectId, kind))
  writeFileSync(
    orderFilePath(rootPath, subjectId, kind),
    JSON.stringify(fileNames, null, 2),
    'utf-8',
  )
}

function sortNotesByOrder(items: NoteMeta[], order: string[]): NoteMeta[] {
  const map = new Map(items.map((item) => [item.fileName, item]))
  const sorted: NoteMeta[] = []
  for (const name of order) {
    const item = map.get(name)
    if (item) {
      sorted.push(item)
      map.delete(name)
    }
  }
  const rest = [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  return [...sorted, ...rest]
}

function upsertOrderEntry(
  rootPath: string,
  subjectId: string,
  kind: NoteKind,
  fileName: string,
  position: 'start' | 'end' = 'start',
): void {
  const order = readOrder(rootPath, subjectId, kind).filter((f) => f !== fileName)
  if (position === 'start') order.unshift(fileName)
  else order.push(fileName)
  writeOrder(rootPath, subjectId, kind, order)
}

function removeOrderEntry(
  rootPath: string,
  subjectId: string,
  kind: NoteKind,
  fileName: string,
): void {
  const order = readOrder(rootPath, subjectId, kind).filter((f) => f !== fileName)
  writeOrder(rootPath, subjectId, kind, order)
}

function renameOrderEntry(
  rootPath: string,
  subjectId: string,
  kind: NoteKind,
  oldName: string,
  newName: string,
): void {
  const order = readOrder(rootPath, subjectId, kind)
  const idx = order.indexOf(oldName)
  if (idx >= 0) {
    order[idx] = newName
    writeOrder(rootPath, subjectId, kind, order)
  } else {
    upsertOrderEntry(rootPath, subjectId, kind, newName, 'start')
  }
}

export function saveNotesOrder(payload: {
  rootPath: string
  subjectId: string
  kind: NoteKind
  fileNames: string[]
}): NoteMeta[] {
  const { rootPath, subjectId, kind, fileNames } = payload
  const dir = join(rootPath, subjectId, kind)
  ensureDir(dir)
  const existing = new Set(
    readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')),
  )
  const ordered = fileNames.filter((f) => existing.has(f))
  for (const f of existing) {
    if (!ordered.includes(f)) ordered.push(f)
  }
  writeOrder(rootPath, subjectId, kind, ordered)
  return listNotes(rootPath, subjectId, kind)
}

export function listNotes(
  rootPath: string,
  subjectId: string,
  kind: NoteKind,
): NoteMeta[] {
  const dir = join(rootPath, subjectId, kind)
  ensureDir(dir)
  const items = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((fileName) => {
      const full = join(dir, fileName)
      const st = statSync(full)
      let title = basename(fileName, '.md')
      try {
        const content = readFileSync(full, 'utf-8')
        title = parseTitle(content, fileName)
      } catch {
        // ignore
      }
      return {
        fileName,
        title,
        kind,
        updatedAt: st.mtimeMs,
        size: st.size,
      }
    })
  return sortNotesByOrder(items, readOrder(rootPath, subjectId, kind))
}

export function readNote(
  rootPath: string,
  subjectId: string,
  kind: NoteKind,
  fileName: string,
): NoteContent {
  const full = join(rootPath, subjectId, kind, fileName)
  const content = readFileSync(full, 'utf-8')
  const st = statSync(full)
  return {
    fileName,
    title: parseTitle(content, fileName),
    content,
    updatedAt: st.mtimeMs,
  }
}

export function writeNote(payload: {
  rootPath: string
  subjectId: string
  kind: NoteKind
  fileName: string
  content: string
  title?: string
}): NoteMeta {
  const { rootPath, subjectId, kind, content, title } = payload
  ensureSubjectDirs(rootPath, subjectId)
  let fileName = payload.fileName
  if (!fileName) {
    const base = safeName(title || '未命名笔记') || '未命名笔记'
    fileName = `${base}.md`
    const dir = join(rootPath, subjectId, kind)
    let i = 1
    while (existsSync(join(dir, fileName))) {
      fileName = `${base}-${i}.md`
      i += 1
    }
  }
  if (!fileName.toLowerCase().endsWith('.md')) fileName += '.md'
  const full = join(rootPath, subjectId, kind, fileName)
  const created = !existsSync(full)
  writeFileSync(full, content, 'utf-8')
  if (created) {
    upsertOrderEntry(rootPath, subjectId, kind, fileName, 'start')
  } else {
    const order = readOrder(rootPath, subjectId, kind)
    if (!order.includes(fileName)) {
      upsertOrderEntry(rootPath, subjectId, kind, fileName, 'end')
    }
  }
  const st = statSync(full)
  return {
    fileName,
    title: title || parseTitle(content, fileName),
    kind,
    updatedAt: st.mtimeMs,
    size: st.size,
  }
}

export function deleteNote(
  rootPath: string,
  subjectId: string,
  kind: NoteKind,
  fileName: string,
): void {
  const full = join(rootPath, subjectId, kind, fileName)
  if (existsSync(full)) unlinkSync(full)
  removeOrderEntry(rootPath, subjectId, kind, fileName)
  if (kind === 'essays') {
    deleteEssayGuideHistory(rootPath, subjectId, fileName)
  }
}

export function renameNote(payload: {
  rootPath: string
  subjectId: string
  kind: NoteKind
  oldName: string
  newName: string
}): NoteMeta {
  const { rootPath, subjectId, kind, oldName } = payload
  let newName = safeName(payload.newName)
  if (!newName.toLowerCase().endsWith('.md')) newName += '.md'
  const dir = join(rootPath, subjectId, kind)
  const from = join(dir, oldName)
  const to = join(dir, newName)
  if (from !== to) {
    if (existsSync(to)) throw new Error('同名文件已存在')
    renameSync(from, to)
    renameOrderEntry(rootPath, subjectId, kind, oldName, newName)
    if (kind === 'essays') {
      renameEssayGuideHistory(rootPath, subjectId, oldName, newName)
    }
  }
  const note = readNote(rootPath, subjectId, kind, newName)
  const st = statSync(join(dir, newName))
  return {
    fileName: note.fileName,
    title: note.title,
    kind,
    updatedAt: note.updatedAt,
    size: st.size,
  }
}

const GUIDE_DIR = '.guides'
const MAX_GUIDE_RECORDS = 20

export interface EssayGuideRecord {
  id: string
  createdAt: number
  guide: Record<string, unknown>
}

export interface EssayGuideHistory {
  fileName: string
  records: EssayGuideRecord[]
}

function guideHistoryPath(rootPath: string, subjectId: string, fileName: string): string {
  return join(rootPath, subjectId, 'essays', GUIDE_DIR, `${fileName}.json`)
}

function emptyGuideHistory(fileName: string): EssayGuideHistory {
  return { fileName, records: [] }
}

export function readEssayGuideHistory(
  rootPath: string,
  subjectId: string,
  fileName: string,
): EssayGuideHistory {
  if (!fileName) return emptyGuideHistory(fileName)
  const file = guideHistoryPath(rootPath, subjectId, fileName)
  if (!existsSync(file)) return emptyGuideHistory(fileName)
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<EssayGuideHistory>
    const records = Array.isArray(raw.records)
      ? raw.records.filter(
          (r): r is EssayGuideRecord =>
            Boolean(r) && typeof r === 'object' && typeof (r as EssayGuideRecord).id === 'string',
        )
      : []
    return { fileName, records }
  } catch {
    return emptyGuideHistory(fileName)
  }
}

export function appendEssayGuideHistory(payload: {
  rootPath: string
  subjectId: string
  fileName: string
  record: EssayGuideRecord
}): EssayGuideHistory {
  const { rootPath, subjectId, fileName, record } = payload
  if (!fileName) return emptyGuideHistory(fileName)
  ensureDir(join(rootPath, subjectId, 'essays', GUIDE_DIR))
  const current = readEssayGuideHistory(rootPath, subjectId, fileName)
  const records = [record, ...current.records.filter((r) => r.id !== record.id)].slice(
    0,
    MAX_GUIDE_RECORDS,
  )
  const next: EssayGuideHistory = { fileName, records }
  writeFileSync(
    guideHistoryPath(rootPath, subjectId, fileName),
    JSON.stringify(next, null, 2),
    'utf-8',
  )
  return next
}

export function deleteEssayGuideHistory(
  rootPath: string,
  subjectId: string,
  fileName: string,
): void {
  if (!fileName) return
  const file = guideHistoryPath(rootPath, subjectId, fileName)
  if (existsSync(file)) unlinkSync(file)
}

export function renameEssayGuideHistory(
  rootPath: string,
  subjectId: string,
  oldName: string,
  newName: string,
): void {
  if (!oldName || oldName === newName) return
  const from = guideHistoryPath(rootPath, subjectId, oldName)
  if (!existsSync(from)) return
  ensureDir(join(rootPath, subjectId, 'essays', GUIDE_DIR))
  const to = guideHistoryPath(rootPath, subjectId, newName)
  if (existsSync(to)) {
    unlinkSync(from)
    return
  }
  renameSync(from, to)
  try {
    const data = JSON.parse(readFileSync(to, 'utf-8')) as EssayGuideHistory
    data.fileName = newName
    writeFileSync(to, JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    // ignore
  }
}
