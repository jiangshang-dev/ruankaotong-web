import { contextBridge, ipcRenderer } from 'electron'

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

export interface SavedImage {
  relativePath: string
  dataUrl: string
  fileName: string
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
  saveNotesOrder: (payload: {
    rootPath: string
    subjectId: string
    kind: NoteKind
    fileNames: string[]
  }): Promise<NoteMeta[]> => ipcRenderer.invoke('notes:saveOrder', payload),
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
  saveImage: (payload: {
    rootPath: string
    subjectId: string
    kind: NoteKind
    bytes: Uint8Array
    mimeType?: string
  }): Promise<SavedImage> => ipcRenderer.invoke('notes:saveImage', payload),
  readImageDataUrl: (payload: {
    rootPath: string
    subjectId: string
    kind: NoteKind
    relativePath: string
  }): Promise<string | null> =>
    ipcRenderer.invoke('notes:readImageDataUrl', payload),
  readEssayGuide: (payload: {
    rootPath: string
    subjectId: string
    fileName: string
  }): Promise<{
    fileName: string
    records: Array<{ id: string; createdAt: number; guide: unknown }>
  }> => ipcRenderer.invoke('essayGuide:read', payload),
  appendEssayGuide: (payload: {
    rootPath: string
    subjectId: string
    fileName: string
    record: { id: string; createdAt: number; guide: unknown }
  }): Promise<{
    fileName: string
    records: Array<{ id: string; createdAt: number; guide: unknown }>
  }> => ipcRenderer.invoke('essayGuide:append', payload),
}

contextBridge.exposeInMainWorld('api', api)

export type RuankaoApi = typeof api
