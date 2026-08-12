import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, statSync } from 'fs'
import { join, basename } from 'path'

export interface AppConfig {
  rootPath: string
  lastSubjectId: string
}

export interface NoteMeta {
  fileName: string
  title: string
  kind: 'notes' | 'essays'
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

export function listNotes(
  rootPath: string,
  subjectId: string,
  kind: 'notes' | 'essays',
): NoteMeta[] {
  const dir = join(rootPath, subjectId, kind)
  ensureDir(dir)
  return readdirSync(dir)
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
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function readNote(
  rootPath: string,
  subjectId: string,
  kind: 'notes' | 'essays',
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
  kind: 'notes' | 'essays'
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
  writeFileSync(full, content, 'utf-8')
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
  kind: 'notes' | 'essays',
  fileName: string,
): void {
  const full = join(rootPath, subjectId, kind, fileName)
  if (existsSync(full)) unlinkSync(full)
}

export function renameNote(payload: {
  rootPath: string
  subjectId: string
  kind: 'notes' | 'essays'
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
