<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { AuthRequiredError, AccountDisabledError } from '../api/auth'
import {
  extractUserQuestion,
  firstMarkdownHeading,
  listKnowledgeTutorHistory,
  streamKnowledgeTutor,
  type KnowledgeTutorHistoryRecord,
} from '../api/knowledgeAi'
import { buildNoteMarkdown, countExamWords, formatDate, parseNoteMarkdown, stripLeadingTitleHeading } from '../utils/exam'
import { markdownToHtml } from '../utils/markdown'
import MarkdownRichEditor from './MarkdownRichEditor.vue'
import EssayThinkingBox from './EssayThinkingBox.vue'

const ASK_CHIPS = [
  { label: '复习建议', question: '请只给出针对当前主题的复习建议，列出今天要默写的关键词和要过的讲义。' },
  { label: '备考方案', question: '请按 18 周打卡计划给出今后 7 天可执行的综合知识备考方案。' },
  { label: '思维导图', question: '请只画出当前主题的思维导图知识树，用多层列表。' },
  { label: '例题详解', question: '请出 3 道上午风格选择题并给出答案、解析和干扰项分析。' },
  { label: '拓展试题', question: '请按近年考纲趋势出 2 道拓展题并做权威详解。' },
]

const props = defineProps<{
  fileName: string
  isNew: boolean
}>()

const emit = defineEmits<{
  created: [fileName: string]
  deleted: []
}>()

type TutorTurn = {
  id: string
  role: 'user' | 'assistant'
  topic: string
  markdown: string
  thinking: string
  createdAt: number
  streaming?: boolean
}

const store = useAppStore()
const title = ref('')
const body = ref('')
const currentName = ref('')
const dirty = ref(false)
const status = ref('')
const editorKey = ref(0)
const aiLoading = ref('')
const tutorHistory = ref<KnowledgeTutorHistoryRecord[]>([])
const tutorTurns = ref<TutorTurn[]>([])
const selectedTutorId = ref('')
const draftHistoryKey = ref('')
const tutorStreamEl = ref<HTMLElement | null>(null)
const guideCollapsed = ref(false)
const historyCollapsed = ref(false)
const generatingTutor = ref(false)
const askText = ref('')
let tutorAbort: AbortController | null = null
const GUIDE_WIDTH_KEY = 'ruankao.noteGuideWidth'
const MIN_GUIDE_WIDTH = 360
const MIN_EDITOR_WIDTH = 280
const layoutEl = ref<HTMLElement | null>(null)
const guideWidth = ref(0)
const resizing = ref(false)
let splitMove: ((e: MouseEvent) => void) | null = null
let splitUp: (() => void) | null = null

const media = computed(() =>
  store.rootPath
    ? {
        rootPath: store.rootPath,
        subjectId: store.subjectId,
        kind: 'notes' as const,
      }
    : null,
)

const wordCount = computed(() => countExamWords(`${title.value}\n${body.value}`))
const historyFileName = computed(() => currentName.value || draftHistoryKey.value)
const recognizedTitle = computed(() => {
  const last = [...tutorTurns.value]
    .reverse()
    .find((turn) => turn.role === 'assistant' && turn.markdown.trim())
  return firstMarkdownHeading(last?.markdown || '') || title.value
})
const hasTutorSession = computed(() =>
  tutorTurns.value.some((turn) => turn.role === 'assistant' && !turn.streaming),
)
const layoutStyle = computed(() => {
  if (guideCollapsed.value || !guideWidth.value) return undefined
  return {
    gridTemplateColumns: `minmax(${MIN_EDITOR_WIDTH}px, 1fr) 8px ${guideWidth.value}px`,
  }
})

function turnHtml(markdown: string): string {
  return markdown.trim() ? markdownToHtml(markdown) : ''
}

function displayUserText(markdown: string): string {
  const text = String(markdown || '').trim()
  if (!text) return ''
  if (text.includes('请针对当前笔记主题做综合知识系统辅导')) return '生成辅导'
  return text
}

function toTurns(records: KnowledgeTutorHistoryRecord[]): TutorTurn[] {
  return [...records].reverse().map((rec) => {
    const role = rec.role === 'user' ? 'user' : 'assistant'
    const markdown =
      role === 'user' ? extractUserQuestion(rec.markdown || rec.topic || '') : rec.markdown || ''
    return {
      id: rec.id,
      role,
      topic: rec.topic || (role === 'user' ? displayUserText(markdown).slice(0, 36) : ''),
      markdown: role === 'user' ? displayUserText(markdown) : markdown,
      thinking: rec.thinking || '',
      createdAt: rec.createdAt,
    }
  })
}

async function load(): Promise<void> {
  if (!generatingTutor.value) {
    abortTutorStream()
  }
  if (props.isNew || !props.fileName) {
    title.value = ''
    body.value = ''
    currentName.value = ''
    dirty.value = false
    draftHistoryKey.value = `draft-${Date.now()}`
    tutorHistory.value = []
    tutorTurns.value = []
    selectedTutorId.value = ''
    askText.value = ''
    status.value = '新建笔记：右侧可生成综合知识 AI 辅导'
    editorKey.value += 1
    return
  }
  const note = await window.api.readNote(
    store.rootPath,
    store.subjectId,
    'notes',
    props.fileName,
  )
  const parsed = parseNoteMarkdown(note.content)
  title.value = parsed.title
  body.value = parsed.body
  currentName.value = note.fileName
  dirty.value = false
  draftHistoryKey.value = ''
  tutorTurns.value = []
  selectedTutorId.value = ''
  askText.value = ''
  await loadTutorHistory(note.fileName)
  status.value = tutorHistory.value.length
    ? `已打开 ${note.fileName} · ${tutorHistory.value.length} 条 AI 辅导`
    : `已打开 ${note.fileName}`
  editorKey.value += 1
}

async function loadTutorHistory(fileName: string, replaceThread = true): Promise<void> {
  if (!fileName || !store.aiLoggedIn) {
    tutorHistory.value = []
    if (replaceThread) tutorTurns.value = []
    return
  }
  try {
    const records = await listKnowledgeTutorHistory(store.subjectId, fileName)
    tutorHistory.value = records
    if (replaceThread) {
      tutorTurns.value = toTurns(records)
      const lastAsst = [...tutorTurns.value].reverse().find((turn) => turn.role === 'assistant')
      selectedTutorId.value = lastAsst?.id || ''
    }
  } catch (e) {
    if (replaceThread) {
      tutorHistory.value = []
      tutorTurns.value = []
    }
    if (e instanceof AuthRequiredError || e instanceof AccountDisabledError) {
      if (e instanceof AccountDisabledError) store.consumeAiAuthError(e)
      return
    }
    status.value = e instanceof Error ? e.message : '读取辅导历史失败'
  }
}

function selectTutor(rec: KnowledgeTutorHistoryRecord): void {
  if (aiLoading.value === 'tutor') return
  selectedTutorId.value = rec.id
  void nextTick(() => {
    const el = document.getElementById(`tutor-turn-${rec.id}`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })
}

function abortTutorStream(): void {
  if (tutorAbort) {
    tutorAbort.abort()
    tutorAbort = null
  }
}

async function scrollTutorToBottom(): Promise<void> {
  await nextTick()
  const el = tutorStreamEl.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => [props.fileName, props.isNew, store.subjectId] as const,
  () => {
    void load()
  },
  { immediate: true },
)

watch(
  () => store.clientEmail,
  () => {
    if (historyFileName.value) void loadTutorHistory(historyFileName.value)
  },
)

function markDirty(): void {
  dirty.value = true
}

async function save(): Promise<void> {
  if (!title.value.trim() && !body.value.trim()) {
    status.value = '请先填写标题或内容'
    return
  }
  store.saving = true
  try {
    const noteTitle = title.value.trim() || '未命名笔记'
    const cleanedBody = stripLeadingTitleHeading(body.value, noteTitle)
    if (cleanedBody !== body.value) {
      body.value = cleanedBody
      editorKey.value += 1
    }
    const content = buildNoteMarkdown(noteTitle, cleanedBody)
    const meta = await window.api.writeNote({
      rootPath: store.rootPath,
      subjectId: store.subjectId,
      kind: 'notes',
      fileName: currentName.value,
      content,
      title: noteTitle,
    })
    currentName.value = meta.fileName
    dirty.value = false
    await loadTutorHistory(currentName.value, tutorTurns.value.length === 0)
    status.value = `已保存 ${meta.fileName}`
    await store.refreshList()
    if (props.isNew || props.fileName !== meta.fileName) {
      emit('created', meta.fileName)
    }
  } catch (e) {
    status.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    store.saving = false
  }
}

async function remove(): Promise<void> {
  if (!currentName.value) {
    emit('deleted')
    return
  }
  if (!confirm(`确认删除「${title.value || currentName.value}」？`)) return
  await window.api.deleteNote(
    store.rootPath,
    store.subjectId,
    'notes',
    currentName.value,
  )
  await store.refreshList()
  emit('deleted')
}

function toggleGuide(): void {
  guideCollapsed.value = !guideCollapsed.value
}

function toggleHistory(): void {
  historyCollapsed.value = !historyCollapsed.value
}

function clampGuideWidth(next: number): number {
  const layout = layoutEl.value
  const max = layout
    ? Math.max(MIN_GUIDE_WIDTH, layout.clientWidth - MIN_EDITOR_WIDTH - 8)
    : 900
  return Math.round(Math.min(max, Math.max(MIN_GUIDE_WIDTH, next)))
}

function stopSplitDrag(): void {
  if (splitMove) window.removeEventListener('mousemove', splitMove)
  if (splitUp) window.removeEventListener('mouseup', splitUp)
  splitMove = null
  splitUp = null
  if (resizing.value) {
    resizing.value = false
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
    try {
      localStorage.setItem(GUIDE_WIDTH_KEY, String(guideWidth.value))
    } catch {
      /* ignore */
    }
  }
}

function onSplitDown(e: MouseEvent): void {
  if (guideCollapsed.value) return
  e.preventDefault()
  const startX = e.clientX
  const startW = guideWidth.value || layoutEl.value?.querySelector('.guide-board')?.clientWidth || 560
  resizing.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  splitMove = (ev: MouseEvent) => {
    guideWidth.value = clampGuideWidth(startW - (ev.clientX - startX))
  }
  splitUp = () => stopSplitDrag()
  window.addEventListener('mousemove', splitMove)
  window.addEventListener('mouseup', splitUp)
}

async function runTutor(question = '', followUp = false): Promise<void> {
  if (!(await store.requireAiLogin())) return
  const q = question.trim()
  if (!title.value.trim() && !body.value.trim() && !q) {
    status.value = '请先写笔记标题或正文，或输入要问的问题'
    return
  }
  abortTutorStream()
  guideCollapsed.value = false
  generatingTutor.value = true
  aiLoading.value = 'tutor'
  status.value = followUp ? '正在根据追问继续辅导…' : '正在生成综合知识 AI 辅导…'
  const streamId = `stream-${Date.now()}`
  try {
    if (!draftHistoryKey.value && !currentName.value) {
      draftHistoryKey.value = `draft-${Date.now()}`
    }
    tutorTurns.value = tutorTurns.value.filter((turn) => !turn.streaming)
    if (q) {
      tutorTurns.value.push({
        id: `user-${Date.now()}`,
        role: 'user',
        topic: q.slice(0, 36),
        markdown: q,
        thinking: '',
        createdAt: Date.now(),
      })
    }
    tutorTurns.value.push({
      id: streamId,
      role: 'assistant',
      topic: '',
      markdown: '',
      thinking: '',
      createdAt: Date.now(),
      streaming: true,
    })
    selectedTutorId.value = streamId
    const controller = new AbortController()
    tutorAbort = controller
    await streamKnowledgeTutor(
      {
        subject: store.subject.name,
        subjectId: store.subjectId,
        fileName: historyFileName.value,
        title: title.value.trim(),
        noteText: body.value,
        question: q,
        followUp,
      },
      (chunk) => {
        const idx = tutorTurns.value.findIndex((turn) => turn.id === streamId)
        if (idx >= 0) {
          tutorTurns.value[idx] = {
            ...tutorTurns.value[idx],
            markdown: chunk.markdown,
            thinking: chunk.thinking,
          }
        }
        void scrollTutorToBottom()
      },
      controller.signal,
    )
    await loadTutorHistory(historyFileName.value, true)
    status.value = followUp ? '追问已追加到当前对话' : '综合知识辅导已写入对话，可继续追问'
    void scrollTutorToBottom()
  } catch (e) {
    tutorTurns.value = tutorTurns.value.map((turn) =>
      turn.id === streamId ? { ...turn, streaming: false } : turn,
    )
    if (e instanceof DOMException && e.name === 'AbortError') {
      status.value = '已停止生成辅导'
      return
    }
    if (store.consumeAiAuthError(e)) {
      status.value = e instanceof Error ? e.message : '请先登录后再使用 AI'
      return
    }
    status.value = e instanceof Error ? e.message : '辅导失败'
  } finally {
    if (tutorAbort && !tutorAbort.signal.aborted) {
      tutorAbort = null
    }
    aiLoading.value = ''
    generatingTutor.value = false
  }
}

function runFollowUp(question?: string): void {
  const q = (question ?? askText.value).trim()
  if (!q) {
    status.value = '请输入追问内容'
    return
  }
  askText.value = ''
  void runTutor(q, hasTutorSession.value)
}

function onAskKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    runFollowUp()
  }
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void save()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  const saved = Number(localStorage.getItem(GUIDE_WIDTH_KEY) || '')
  if (Number.isFinite(saved) && saved >= MIN_GUIDE_WIDTH) {
    guideWidth.value = clampGuideWidth(saved)
  } else if (layoutEl.value) {
    guideWidth.value = clampGuideWidth(Math.round(layoutEl.value.clientWidth * 0.5))
  } else {
    guideWidth.value = 560
  }
})
onBeforeUnmount(() => {
  abortTutorStream()
  stopSplitDrag()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    ref="layoutEl"
    class="essay-layout note-tutor-layout"
    :class="{
      'guide-collapsed': guideCollapsed,
      'history-collapsed': historyCollapsed,
      'is-resizing': resizing,
    }"
    :style="layoutStyle"
  >
    <div class="editor-toolbar" style="padding: 0; border: none">
      <div class="status">{{ status }}{{ dirty ? ' · 未保存' : '' }}</div>
      <div class="actions">
        <button v-if="!store.aiLoggedIn" class="btn light" type="button" @click="store.openAiLogin">
          登录
        </button>
        <button
          v-else
          class="btn light"
          type="button"
          :title="store.clientEmail"
          @click="store.openProfile"
        >
          {{ store.clientName || '个人中心' }}
        </button>
        <button class="btn light" :disabled="!!aiLoading" @click="runTutor()">
          {{ aiLoading === 'tutor' ? '辅导中…' : 'AI 辅导' }}
        </button>
        <button class="btn" :disabled="store.saving || !!aiLoading" @click="save">保存</button>
        <button class="btn danger" :disabled="!!aiLoading" @click="remove">删除</button>
        <button
          class="btn light"
          type="button"
          :title="guideCollapsed ? '展开 AI 辅导' : '收起 AI 辅导'"
          @click="toggleGuide"
        >
          {{ guideCollapsed ? '显示辅导' : '隐藏辅导' }}
        </button>
      </div>
    </div>

    <div class="essay-stack">
      <div class="essay-panel essay-panel--note">
        <div class="panel-head">
          <strong>知识点笔记</strong>
          <span class="status">右侧按讲义做综合知识辅导，生成后可连续追问</span>
        </div>
        <div class="field">
          <input
            v-model="title"
            placeholder="例如：软件架构风格与质量属性"
            @input="markDirty"
          />
        </div>
        <div class="field note-body-editor">
          <MarkdownRichEditor
            :key="editorKey"
            v-model="body"
            :media="media"
            placeholder="写下本章要点，点「生成辅导」讲解、出题、给复习方案…"
            @change="markDirty"
          />
        </div>
      </div>
    </div>

    <div
      v-if="!guideCollapsed"
      class="pane-splitter"
      title="拖动调整左右宽度"
      @mousedown="onSplitDown"
    />

    <aside class="guide-board">
      <button
        v-if="guideCollapsed"
        class="pane-rail pane-rail--right"
        type="button"
        title="展开 AI 辅导"
        @click="toggleGuide"
      >
        <span>AI 辅导</span>
      </button>
      <div class="guide-board-head">
        <div class="guide-board-title">
          <strong>综合知识辅导</strong>
          <span class="status">
            {{
              aiLoading === 'tutor'
                ? '正在流式生成…'
                : recognizedTitle || '按讲义讲解、出题，并可连续追问'
            }}
          </span>
        </div>
        <div class="actions">
          <button class="btn" :disabled="!!aiLoading" @click="runTutor()">
            {{ aiLoading === 'tutor' ? '生成中…' : '生成辅导' }}
          </button>
          <button
            class="pane-toggle"
            type="button"
            title="收起 AI 辅导"
            @click="toggleGuide"
          >
            ›
          </button>
        </div>
      </div>
      <div class="guide-board-body">
        <div class="guide-history" :class="{ collapsed: historyCollapsed }">
          <div class="guide-history-head">
            <div class="guide-history-label">对话</div>
            <button
              class="pane-toggle"
              type="button"
              title="收起历史记录"
              @click="toggleHistory"
            >
              ‹
            </button>
          </div>
          <button
            v-if="historyCollapsed"
            class="pane-rail pane-rail--left"
            type="button"
            title="展开历史记录"
            @click="toggleHistory"
          >
            <span>对话</span>
          </button>
          <div class="guide-history-list">
            <button
              v-for="rec in tutorHistory"
              :key="rec.id"
              class="guide-history-item"
              :class="{ active: rec.id === selectedTutorId, user: rec.role === 'user' }"
              :disabled="aiLoading === 'tutor'"
              @click="selectTutor(rec)"
            >
              <span class="guide-history-topic">
                {{
                  rec.role === 'user'
                    ? rec.topic || '追问'
                    : rec.topic || recognizedTitle || '综合知识辅导'
                }}
              </span>
              <span class="guide-history-time">{{ formatDate(rec.createdAt) }}</span>
            </button>
            <div v-if="!tutorHistory.length" class="guide-history-empty">
              生成后会记入同一会话，追问不会丢掉前面的讲解
            </div>
          </div>
        </div>
        <div ref="tutorStreamEl" class="guide-stream tutor-chat">
          <div
            v-if="!tutorTurns.length && aiLoading !== 'tutor'"
            class="guide-empty"
          >
            在左侧写下知识点，点「生成辅导」。追问会像聊天一样追加在下面，向上滚还能看到前面的内容。
          </div>
          <article
            v-for="turn in tutorTurns"
            :id="`tutor-turn-${turn.id}`"
            :key="turn.id"
            class="chat-row"
            :class="turn.role === 'user' ? 'chat-row--user' : 'chat-row--ai'"
          >
            <template v-if="turn.role === 'user'">
              <div class="chat-col">
                <div class="chat-meta">
                  <span>{{ formatDate(turn.createdAt) }}</span>
                  <strong>我</strong>
                </div>
                <div class="chat-bubble chat-bubble--user">{{ turn.markdown }}</div>
              </div>
              <div class="chat-avatar chat-avatar--user" aria-hidden="true">我</div>
            </template>
            <template v-else>
              <div class="chat-avatar chat-avatar--ai" aria-hidden="true">AI</div>
              <div class="chat-col">
                <div class="chat-meta">
                  <strong>AI 辅导</strong>
                  <span>{{ formatDate(turn.createdAt) }}</span>
                </div>
                <EssayThinkingBox
                  :thinking="turn.thinking"
                  :loading="!!turn.streaming && aiLoading === 'tutor'"
                />
                <div
                  v-if="turn.thinking || turn.markdown || turn.streaming"
                  class="chat-bubble chat-bubble--ai"
                >
                  <pre
                    v-if="turn.streaming && turn.markdown"
                    class="guide-stream-raw"
                  >{{ turn.markdown }}</pre>
                  <div
                    v-else-if="turnHtml(turn.markdown)"
                    class="guide-md"
                    v-html="turnHtml(turn.markdown)"
                  />
                  <span
                    v-if="turn.streaming && turn.markdown && aiLoading === 'tutor'"
                    class="guide-caret"
                  />
                </div>
              </div>
            </template>
          </article>
        </div>
      </div>
      <div class="guide-ask">
        <div class="guide-ask-chips">
          <button
            v-for="chip in ASK_CHIPS"
            :key="chip.label"
            class="guide-ask-chip"
            type="button"
            :disabled="!!aiLoading"
            @click="runFollowUp(chip.question)"
          >
            {{ chip.label }}
          </button>
        </div>
        <div class="guide-ask-row">
          <textarea
            v-model="askText"
            rows="2"
            :disabled="!!aiLoading"
            placeholder="针对讲解继续追问，例如：对比微服务和 SOA，再出 2 道题…"
            @keydown="onAskKeydown"
          />
          <button
            class="btn"
            type="button"
            :disabled="!!aiLoading || !askText.trim()"
            @click="runFollowUp()"
          >
            {{ hasTutorSession ? '追问' : '提问' }}
          </button>
        </div>
      </div>
    </aside>

    <div class="word-bar">
      <span class="word-chip">
        字数 <b>{{ wordCount }}</b>
      </span>
      <span class="status">支持截图粘贴；中文按字、英文整词、标点各计 1</span>
    </div>
  </div>
</template>
