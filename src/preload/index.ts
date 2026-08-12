import { contextBridge, ipcRenderer } from 'electron'

export type NoteKind = 'notes' | 'essays'

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

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  saveConfig: (config: AppConfig): Promise<AppConfig> =>
    ipcRenderer.invoke('config:save', config),
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDirectory'),
  ensureSubject: (rootPath: string, subjectId: string): Promise<void> =>
    ipcRenderer.invoke('notes:ensureSubject', rootPath, subjectId),
  listNotes: (
    rootPath: string,
    subjectId: string,
    kind: NoteKind,
  ): Promise<NoteMeta[]> =>
    ipcRenderer.invoke('notes:list', rootPath, subjectId, kind),
  readNote: (
    rootPath: string,
    subjectId: string,
    kind: NoteKind,
    fileName: string,
  ): Promise<NoteContent> =>
    ipcRenderer.invoke('notes:read', rootPath, subjectId, kind, fileName),
  writeNote: (payload: {
    rootPath: string
    subjectId: string
    kind: NoteKind
    fileName: string
    content: string
    title?: string
  }): Promise<NoteMeta> => ipcRenderer.invoke('notes:write', payload),
  deleteNote: (
    rootPath: string,
    subjectId: string,
    kind: NoteKind,
    fileName: string,
  ): Promise<void> =>
    ipcRenderer.invoke('notes:delete', rootPath, subjectId, kind, fileName),
  renameNote: (payload: {
    rootPath: string
    subjectId: string
    kind: NoteKind
    oldName: string
    newName: string
  }): Promise<NoteMeta> => ipcRenderer.invoke('notes:rename', payload),
  openPath: (targetPath: string): Promise<string> =>
    ipcRenderer.invoke('shell:openPath', targetPath),
}

contextBridge.exposeInMainWorld('api', api)

export type RuankaoApi = typeof api
