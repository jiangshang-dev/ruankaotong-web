import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getSubject } from '../data/subjects'

export type NoteKind = 'notes' | 'essays'

export interface NoteMeta {
  fileName: string
  title: string
  kind: NoteKind
  updatedAt: number
  size: number
}

export const useAppStore = defineStore('app', () => {
  const rootPath = ref('')
  const subjectId = ref('architect')
  const kind = ref<NoteKind>('notes')
  const notes = ref<NoteMeta[]>([])
  const currentFile = ref('')
  const ready = ref(false)
  const saving = ref(false)
  const statusText = ref('')

  const subject = computed(() => getSubject(subjectId.value))
  const hasWorkspace = computed(() => Boolean(rootPath.value))

  async function bootstrap(): Promise<void> {
    const config = await window.api.getConfig()
    rootPath.value = config.rootPath || ''
    subjectId.value = config.lastSubjectId || 'architect'
    if (rootPath.value) {
      await window.api.ensureSubject(rootPath.value, subjectId.value)
      await refreshList()
    }
    ready.value = true
  }

  async function persistConfig(): Promise<void> {
    await window.api.saveConfig({
      rootPath: rootPath.value,
      lastSubjectId: subjectId.value,
    })
  }

  async function chooseWorkspace(): Promise<boolean> {
    const dir = await window.api.selectDirectory()
    if (!dir) return false
    rootPath.value = dir
    await window.api.ensureSubject(rootPath.value, subjectId.value)
    await persistConfig()
    currentFile.value = ''
    await refreshList()
    statusText.value = `已选择目录：${dir}`
    return true
  }

  async function setSubject(id: string): Promise<void> {
    subjectId.value = id
    currentFile.value = ''
    if (rootPath.value) {
      await window.api.ensureSubject(rootPath.value, subjectId.value)
      await refreshList()
    }
    await persistConfig()
  }

  async function setKind(next: NoteKind): Promise<void> {
    kind.value = next
    currentFile.value = ''
    if (rootPath.value) await refreshList()
  }

  async function refreshList(): Promise<void> {
    if (!rootPath.value) {
      notes.value = []
      return
    }
    notes.value = await window.api.listNotes(
      rootPath.value,
      subjectId.value,
      kind.value,
    )
  }

  /** 拖动排序时本地即时重排 */
  function moveNote(fromIndex: number, toIndex: number): void {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= notes.value.length ||
      toIndex >= notes.value.length
    ) {
      return
    }
    const list = [...notes.value]
    const [item] = list.splice(fromIndex, 1)
    list.splice(toIndex, 0, item)
    notes.value = list
  }

  async function persistNotesOrder(): Promise<void> {
    if (!rootPath.value) return
    notes.value = await window.api.saveNotesOrder({
      rootPath: rootPath.value,
      subjectId: subjectId.value,
      kind: kind.value,
      fileNames: notes.value.map((n) => n.fileName),
    })
  }

  function selectFile(fileName: string): void {
    currentFile.value = fileName
  }

  return {
    rootPath,
    subjectId,
    kind,
    notes,
    currentFile,
    ready,
    saving,
    statusText,
    subject,
    hasWorkspace,
    bootstrap,
    persistConfig,
    chooseWorkspace,
    setSubject,
    setKind,
    refreshList,
    moveNote,
    persistNotesOrder,
    selectFile,
  }
})
