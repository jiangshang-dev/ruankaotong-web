import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { SUBJECTS, getSubject, type Subject } from '../data/subjects'
import { listEnabledSubjects } from '../api/subjects'
import {
  AccountDisabledError,
  AuthRequiredError,
  clearClientAuth,
  fetchClientMe,
  getClientEmail,
  getClientName,
  getClientToken,
  logoutClient,
  saveClientAuth,
  updateClientProfile,
} from '../api/auth'

export type NoteKind = 'notes' | 'essays' | 'cases'

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
  const subjects = ref<Subject[]>(SUBJECTS)
  const clientEmail = ref('')
  const clientName = ref('')
  const loginOpen = ref(false)
  const profileOpen = ref(false)
  const loginWaiters: Array<(ok: boolean) => void> = []

  const subject = computed(() => getSubject(subjectId.value, subjects.value))
  const hasWorkspace = computed(() => Boolean(rootPath.value))
  const aiLoggedIn = computed(() => Boolean(clientEmail.value))

  async function bootstrap(): Promise<void> {
    const config = await window.api.getConfig()
    rootPath.value = config.rootPath || ''
    subjectId.value = config.lastSubjectId || 'architect'
    const remote = await listEnabledSubjects()
    if (remote.length) {
      subjects.value = remote
      if (!remote.some((s) => s.id === subjectId.value)) {
        subjectId.value = remote[0].id
      }
    }
    if (rootPath.value) {
      await window.api.ensureSubject(rootPath.value, subjectId.value)
      await refreshList()
    }
    if (getClientToken()) {
      const me = await fetchClientMe()
      if (me?.email) {
        clientEmail.value = me.email
        clientName.value = me.name || getClientName()
        saveClientAuth(getClientToken(), me.email, clientName.value)
      } else {
        clearClientAuth()
        clientEmail.value = ''
        clientName.value = ''
      }
    } else {
      clientEmail.value = getClientEmail()
      clientName.value = getClientName()
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

  function openAiLogin(): void {
    loginOpen.value = true
  }

  function requireAiLogin(): Promise<boolean> {
    if (clientEmail.value && getClientToken()) return Promise.resolve(true)
    loginOpen.value = true
    return new Promise((resolve) => {
      loginWaiters.push(resolve)
    })
  }

  function openProfile(): void {
    if (!aiLoggedIn.value) {
      loginOpen.value = true
      return
    }
    profileOpen.value = true
  }

  function closeProfile(): void {
    profileOpen.value = false
  }

  function finishAiLogin(ok: boolean, email = '', name = ''): void {
    if (ok && email) {
      clientEmail.value = email
      clientName.value = name || getClientName() || email
    }
    loginOpen.value = false
    while (loginWaiters.length) {
      const wait = loginWaiters.shift()
      wait?.(ok)
    }
  }

  async function logoutAi(): Promise<void> {
    await logoutClient()
    clientEmail.value = ''
    clientName.value = ''
    profileOpen.value = false
  }

  async function saveProfileName(name: string): Promise<void> {
    const data = await updateClientProfile(name)
    clientName.value = data.name
    saveClientAuth(getClientToken(), data.email, data.name)
  }

  function consumeAiAuthError(e: unknown): boolean {
    if (e instanceof AccountDisabledError) {
      clearClientAuth()
      clientEmail.value = ''
      clientName.value = ''
      profileOpen.value = false
      return true
    }
    if (!(e instanceof AuthRequiredError)) return false
    clearClientAuth()
    clientEmail.value = ''
    clientName.value = ''
    loginOpen.value = true
    return true
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
    subjects,
    subject,
    hasWorkspace,
    clientEmail,
    clientName,
    loginOpen,
    profileOpen,
    aiLoggedIn,
    bootstrap,
    persistConfig,
    chooseWorkspace,
    setSubject,
    setKind,
    refreshList,
    moveNote,
    persistNotesOrder,
    selectFile,
    openAiLogin,
    openProfile,
    closeProfile,
    requireAiLogin,
    finishAiLogin,
    logoutAi,
    saveProfileName,
    consumeAiAuthError,
  }
})
