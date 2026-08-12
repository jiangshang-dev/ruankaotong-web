import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import {
  ensureSubjectDirs,
  listNotes,
  readNote,
  writeNote,
  deleteNote,
  renameNote,
  getAppConfig,
  saveAppConfig,
  saveNoteImage,
  readNoteImageDataUrl,
  type NoteMeta,
  type NoteContent,
  type AppConfig,
  type SavedImage,
} from './fs-service'

const isDev = !app.isPackaged

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: '软考通',
    backgroundColor: '#f4f7f5',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.ruankaotong.app')
  }

  ipcMain.handle('config:get', async (): Promise<AppConfig> => {
    return getAppConfig(app.getPath('userData'))
  })

  ipcMain.handle(
    'config:save',
    async (_e, config: AppConfig): Promise<AppConfig> => {
      return saveAppConfig(app.getPath('userData'), config)
    },
  )

  ipcMain.handle('dialog:selectDirectory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择笔记保存目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'notes:ensureSubject',
    async (_e, rootPath: string, subjectId: string): Promise<void> => {
      ensureSubjectDirs(rootPath, subjectId)
    },
  )

  ipcMain.handle(
    'notes:list',
    async (
      _e,
      rootPath: string,
      subjectId: string,
      kind: 'notes' | 'essays',
    ): Promise<NoteMeta[]> => {
      return listNotes(rootPath, subjectId, kind)
    },
  )

  ipcMain.handle(
    'notes:read',
    async (
      _e,
      rootPath: string,
      subjectId: string,
      kind: 'notes' | 'essays',
      fileName: string,
    ): Promise<NoteContent> => {
      return readNote(rootPath, subjectId, kind, fileName)
    },
  )

  ipcMain.handle(
    'notes:write',
    async (
      _e,
      payload: {
        rootPath: string
        subjectId: string
        kind: 'notes' | 'essays'
        fileName: string
        content: string
        title?: string
      },
    ): Promise<NoteMeta> => {
      return writeNote(payload)
    },
  )

  ipcMain.handle(
    'notes:delete',
    async (
      _e,
      rootPath: string,
      subjectId: string,
      kind: 'notes' | 'essays',
      fileName: string,
    ): Promise<void> => {
      deleteNote(rootPath, subjectId, kind, fileName)
    },
  )

  ipcMain.handle(
    'notes:rename',
    async (
      _e,
      payload: {
        rootPath: string
        subjectId: string
        kind: 'notes' | 'essays'
        oldName: string
        newName: string
      },
    ): Promise<NoteMeta> => {
      return renameNote(payload)
    },
  )

  ipcMain.handle('shell:openPath', async (_e, targetPath: string) => {
    if (!targetPath) return 'empty'
    return shell.openPath(targetPath)
  })

  ipcMain.handle(
    'notes:saveImage',
    async (
      _e,
      payload: {
        rootPath: string
        subjectId: string
        kind: 'notes' | 'essays'
        bytes: Uint8Array
        mimeType?: string
      },
    ): Promise<SavedImage> => {
      return saveNoteImage(payload)
    },
  )

  ipcMain.handle(
    'notes:readImageDataUrl',
    async (
      _e,
      payload: {
        rootPath: string
        subjectId: string
        kind: 'notes' | 'essays'
        relativePath: string
      },
    ): Promise<string | null> => {
      return readNoteImageDataUrl(payload)
    },
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
