<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import {
  compressImageDataUrl,
  extractMarkdownSection,
  firstMarkdownHeading,
  listCaseExplainHistory,
  scoreCase,
  streamCaseExplain,
  type CaseExplainHistoryRecord,
  type CaseImage,
  type CaseScoreResponse,
} from '../api/caseAi'
import {
  buildCaseMarkdown,
  countExamWords,
  formatDate,
  parseCaseMarkdown,
  stripCaseTopicText,
} from '../utils/exam'
import { collectAssetPaths, markdownToHtml } from '../utils/markdown'
import MarkdownRichEditor from './MarkdownRichEditor.vue'
import EssayThinkingBox from './EssayThinkingBox.vue'

const props = defineProps<{
  fileName: string
  isNew: boolean
}>()

const emit = defineEmits<{
  created: [fileName: string]
  deleted: []
}>()

const store = useAppStore()
const title = ref('')
const topic = ref('')
const answer = ref('')
const currentName = ref('')
const dirty = ref(false)
const status = ref('')
const editorKey = ref(0)
const aiLoading = ref('')
const scoreOpen = ref(false)
const scoreResult = ref<CaseScoreResponse | null>(null)
const explainHistory = ref<CaseExplainHistoryRecord[]>([])
const explainMarkdown = ref('')
const explainThinking = ref('')
const selectedExplainId = ref('')
const draftHistoryKey = ref('')
const explainStreamEl = ref<HTMLElement | null>(null)
const guideCollapsed = ref(false)
const historyCollapsed = ref(false)
const generatingExplain = ref(false)
let explainAbort: AbortController | null = null

const media = computed(() =>
  store.rootPath
    ? {
        rootPath: store.rootPath,
        subjectId: store.subjectId,
        kind: 'cases' as const,
      }
    : null,
)

const answerCount = computed(() => countExamWords(answer.value))
const historyFileName = computed(() => currentName.value || draftHistoryKey.value)
const explainHtml = computed(() =>
  explainMarkdown.value.trim() ? markdownToHtml(explainMarkdown.value) : '',
)
const answerDraft = computed(() => extractMarkdownSection(explainMarkdown.value, '参考答案'))
const recognizedTitle = computed(
  () => firstMarkdownHeading(explainMarkdown.value) || title.value,
)

async function load(): Promise<void> {
  if (!generatingExplain.value) {
    abortExplainStream()
  }
  if (props.isNew || !props.fileName) {
    title.value = ''
    topic.value = ''
    answer.value = ''
    currentName.value = ''
    dirty.value = false
    draftHistoryKey.value = `draft-${Date.now()}`
    explainHistory.value = []
    explainMarkdown.value = ''
    explainThinking.value = ''
    selectedExplainId.value = ''
    status.value = '新建案例分析：上方粘贴题目截图，右侧可生成 AI 讲解'
    editorKey.value += 1
    return
  }
  const note = await window.api.readNote(
    store.rootPath,
    store.subjectId,
    'cases',
    props.fileName,
  )
  const parsed = parseCaseMarkdown(note.content)
  title.value = parsed.title
  topic.value = parsed.topic
  answer.value = parsed.answer
  currentName.value = note.fileName
  dirty.value = false
  draftHistoryKey.value = ''
  explainMarkdown.value = ''
  explainThinking.value = ''
  selectedExplainId.value = ''
  await loadExplainHistory(note.fileName)
  status.value = explainHistory.value.length
    ? `已打开 ${note.fileName} · ${explainHistory.value.length} 条 AI 讲解`
    : `已打开 ${note.fileName}`
  editorKey.value += 1
}

async function loadExplainHistory(fileName: string): Promise<void> {
  if (!fileName) {
    explainHistory.value = []
    return
  }
  try {
    const records = await listCaseExplainHistory(store.subjectId, fileName)
    explainHistory.value = records
    if (!explainMarkdown.value && records.length) {
      selectExplain(records[0])
    }
  } catch (e) {
    explainHistory.value = []
    status.value = e instanceof Error ? e.message : '读取讲解历史失败'
  }
}

function selectExplain(rec: CaseExplainHistoryRecord): void {
  if (aiLoading.value === 'explain') return
  selectedExplainId.value = rec.id
  explainMarkdown.value = rec.markdown || ''
  explainThinking.value = rec.thinking || ''
}

function abortExplainStream(): void {
  if (explainAbort) {
    explainAbort.abort()
    explainAbort = null
  }
}

async function scrollExplainToBottom(): Promise<void> {
  await nextTick()
  const el = explainStreamEl.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => [props.fileName, props.isNew, store.subjectId] as const,
  () => {
    void load()
  },
  { immediate: true },
)

function markDirty(): void {
  dirty.value = true
}

async function save(): Promise<void> {
  const caseTitle = title.value.trim() || '未命名案例分析'
  if (!title.value.trim() && !topic.value.trim() && !answer.value.trim()) {
    status.value = '请先填写标题、粘贴题目或作答'
    return
  }
  store.saving = true
  try {
    const content = buildCaseMarkdown({
      title: caseTitle,
      topic: topic.value,
      answer: answer.value,
    })
    const meta = await window.api.writeNote({
      rootPath: store.rootPath,
      subjectId: store.subjectId,
      kind: 'cases',
      fileName: currentName.value,
      content,
      title: caseTitle,
    })
    currentName.value = meta.fileName
    if (!title.value.trim()) title.value = caseTitle
    dirty.value = false
    await loadExplainHistory(currentName.value)
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
  const name = title.value || currentName.value
  if (!confirm(`确认删除案例分析「${name}」？`)) return
  await window.api.deleteNote(
    store.rootPath,
    store.subjectId,
    'cases',
    currentName.value,
  )
  await store.refreshList()
  emit('deleted')
}

async function collectImages(): Promise<CaseImage[]> {
  if (!media.value) return []
  const paths = collectAssetPaths(topic.value).slice(0, 8)
  const images: CaseImage[] = []
  for (const rel of paths) {
    const dataUrl = await window.api.readImageDataUrl({
      rootPath: media.value.rootPath,
      subjectId: media.value.subjectId,
      kind: 'cases',
      relativePath: rel,
    })
    if (!dataUrl) continue
    images.push(await compressImageDataUrl(dataUrl))
  }
  return images
}

function toggleGuide(): void {
  guideCollapsed.value = !guideCollapsed.value
}

function toggleHistory(): void {
  historyCollapsed.value = !historyCollapsed.value
}

async function runExplain(): Promise<void> {
  abortExplainStream()
  guideCollapsed.value = false
  generatingExplain.value = true
  aiLoading.value = 'explain'
  status.value = '正在识题并流式生成案例分析讲解…'
  try {
    const images = await collectImages()
    const topicText = stripCaseTopicText(topic.value)
    if (!images.length && !topicText.trim()) {
      status.value = '请先在上方粘贴题目截图'
      return
    }
    if (!draftHistoryKey.value && !currentName.value) {
      draftHistoryKey.value = `draft-${Date.now()}`
    }
    explainMarkdown.value = ''
    explainThinking.value = ''
    selectedExplainId.value = ''
    const controller = new AbortController()
    explainAbort = controller
    await streamCaseExplain(
      {
        subject: store.subject.name,
        subjectId: store.subjectId,
        fileName: historyFileName.value,
        title: title.value.trim(),
        topicText,
        answerText: answer.value,
        images,
      },
      (chunk) => {
        explainMarkdown.value = chunk.markdown
        explainThinking.value = chunk.thinking
        void scrollExplainToBottom()
      },
      controller.signal,
    )
    await loadExplainHistory(historyFileName.value)
    const latest = explainHistory.value[0]
    if (latest) {
      selectedExplainId.value = latest.id
      if (latest.thinking) explainThinking.value = latest.thinking
      if (latest.markdown) explainMarkdown.value = latest.markdown
    }
    status.value = '案例分析讲解已写入历史'
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      status.value = '已停止生成讲解'
      return
    }
    status.value = e instanceof Error ? e.message : '讲解失败'
  } finally {
    if (explainAbort && !explainAbort.signal.aborted) {
      explainAbort = null
    }
    aiLoading.value = ''
    generatingExplain.value = false
  }
}

function applyAnswerDraft(): void {
  const draft = answerDraft.value
  if (!draft) return
  if (answer.value.trim() && !confirm('将覆盖当前答案，是否继续？')) return
  answer.value = draft
  dirty.value = true
  status.value = '已写入参考答案，请检查后保存'
}

async function runScore(): Promise<void> {
  if (!answer.value.trim()) {
    status.value = '请先按题号填写答案再评分'
    return
  }
  aiLoading.value = 'score'
  status.value = 'AI 评分中…'
  try {
    const images = await collectImages()
    const topicText = stripCaseTopicText(topic.value)
    if (!images.length && !topicText) {
      status.value = '请先粘贴题目截图后再评分'
      return
    }
    const res = await scoreCase({
      subject: store.subject.name,
      title: title.value.trim(),
      topicText,
      answerText: answer.value,
      images,
    })
    scoreResult.value = res
    scoreOpen.value = true
    status.value = `AI 评分完成：${res.totalScore} 分（${res.level || '-'}）`
  } catch (e) {
    status.value = e instanceof Error ? e.message : '评分失败'
  } finally {
    aiLoading.value = ''
  }
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void save()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  abortExplainStream()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="essay-layout"
    :class="{
      'guide-collapsed': guideCollapsed,
      'history-collapsed': historyCollapsed,
    }"
  >
    <div class="editor-toolbar" style="padding: 0; border: none">
      <div class="status">{{ status }}{{ dirty ? ' · 未保存' : '' }}</div>
      <div class="actions">
        <button class="btn light" :disabled="!!aiLoading" @click="runExplain">
          {{ aiLoading === 'explain' ? '讲解中…' : 'AI 讲解' }}
        </button>
        <button class="btn" :disabled="!!aiLoading" @click="runScore">
          {{ aiLoading === 'score' ? '评分中…' : 'AI 评分' }}
        </button>
        <button class="btn" :disabled="store.saving || !!aiLoading" @click="save">
          保存
        </button>
        <button class="btn danger" :disabled="!!aiLoading" @click="remove">删除</button>
        <button
          class="btn light"
          type="button"
          :title="guideCollapsed ? '展开 AI 讲解' : '收起 AI 讲解'"
          @click="toggleGuide"
        >
          {{ guideCollapsed ? '显示讲解' : '隐藏讲解' }}
        </button>
      </div>
    </div>

    <div class="essay-stack">
      <div class="essay-panel essay-panel--question">
        <div class="panel-head">
          <strong>题目</strong>
          <span class="status">粘贴试卷截图，右侧讲解解题技巧并给参考答案</span>
        </div>
        <div class="field">
          <input
            v-model="title"
            placeholder="标题，例如：2024 上半年试题一"
            @input="markDirty"
          />
        </div>
        <div class="field case-topic-editor">
          <MarkdownRichEditor
            :key="editorKey"
            v-model="topic"
            :media="media"
            placeholder="在此粘贴案例分析题目截图（Ctrl/Cmd+V），可连续粘贴多张…"
            @change="markDirty"
          />
        </div>
      </div>

      <div class="essay-panel essay-panel--answer">
        <div class="panel-head">
          <strong>答案</strong>
          <span class="status">只需标清题号，如【问题1】、(1)、问题2</span>
        </div>
        <div class="field">
          <textarea
            v-model="answer"
            placeholder="【问题1】&#10;（按采分点作答）&#10;&#10;【问题1】(1)&#10;……&#10;&#10;【问题2】&#10;……"
            @input="markDirty"
          />
        </div>
      </div>
    </div>

    <aside class="guide-board">
      <button
        v-if="guideCollapsed"
        class="pane-rail pane-rail--right"
        type="button"
        title="展开 AI 讲解"
        @click="toggleGuide"
      >
        <span>AI 讲解</span>
      </button>
      <div class="guide-board-head">
        <div class="guide-board-title">
          <strong>AI 讲解</strong>
          <span class="status">
            {{
              aiLoading === 'explain'
                ? '正在流式生成…'
                : recognizedTitle || '按题目讲解解题技巧并给参考答案'
            }}
          </span>
        </div>
        <div class="actions">
          <button
            class="btn"
            :disabled="!!aiLoading"
            @click="runExplain"
          >
            {{ aiLoading === 'explain' ? '生成中…' : '生成讲解' }}
          </button>
          <button
            v-if="answerDraft"
            class="btn light"
            :disabled="aiLoading === 'explain'"
            @click="applyAnswerDraft"
          >
            写入参考答案
          </button>
          <button
            class="pane-toggle"
            type="button"
            title="收起 AI 讲解"
            @click="toggleGuide"
          >
            ›
          </button>
        </div>
      </div>
      <div class="guide-board-body">
        <div class="guide-history" :class="{ collapsed: historyCollapsed }">
          <div class="guide-history-head">
            <div class="guide-history-label">历史记录</div>
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
            <span>历史记录</span>
          </button>
          <div class="guide-history-list">
            <button
              v-for="rec in explainHistory"
              :key="rec.id"
              class="guide-history-item"
              :class="{ active: rec.id === selectedExplainId }"
              :disabled="aiLoading === 'explain'"
              @click="selectExplain(rec)"
            >
              <span class="guide-history-topic">{{ rec.topic || recognizedTitle || '案例分析讲解' }}</span>
              <span class="guide-history-time">{{ formatDate(rec.createdAt) }}</span>
            </button>
            <div v-if="!explainHistory.length" class="guide-history-empty">
              生成后会记入会话历史，下次打开还能看
            </div>
          </div>
        </div>
        <div ref="explainStreamEl" class="guide-stream">
          <EssayThinkingBox
            :thinking="explainThinking"
            :loading="aiLoading === 'explain'"
          />
          <pre
            v-if="explainMarkdown && aiLoading === 'explain'"
            class="guide-stream-raw"
          >{{ explainMarkdown }}</pre>
          <div v-else-if="explainHtml" class="guide-md" v-html="explainHtml" />
          <span v-if="aiLoading === 'explain' && explainMarkdown" class="guide-caret" />
          <div v-else-if="!explainMarkdown && !explainThinking && aiLoading !== 'explain'" class="guide-empty">
            在左侧粘贴题目截图，点「生成讲解」。思考默认折叠，讲解正文会边生成边出现。
          </div>
        </div>
      </div>
    </aside>

    <div class="word-bar">
      <span class="word-chip">
        作答 <b>{{ answerCount }}</b>
      </span>
      <span class="status">截图后点「AI 讲解」看解题技巧和参考答案，写完可「AI 评分」</span>
    </div>

    <div v-if="scoreOpen && scoreResult" class="score-modal-mask" @click.self="scoreOpen = false">
      <div class="score-modal">
        <div class="score-modal-head">
          <h3>AI 评分解读</h3>
          <button class="btn light" @click="scoreOpen = false">关闭</button>
        </div>
        <div class="score-hero">
          <div class="score-num">{{ scoreResult.totalScore }}<span class="score-max">/75</span></div>
          <div>
            <div
              class="score-level"
              :class="scoreResult.totalScore >= 45 ? 'ok' : 'fail'"
            >
              {{ scoreResult.level || (scoreResult.totalScore >= 45 ? '合格' : '不及格') }}
              <span class="score-pass-hint">（≥45 合格）</span>
            </div>
            <p>{{ scoreResult.summary }}</p>
          </div>
        </div>
        <div v-if="scoreResult.dimensions?.length" class="score-dims">
          <div
            v-for="(d, i) in scoreResult.dimensions"
            :key="i"
            class="score-dim"
          >
            <div class="score-dim-top">
              <strong>{{ d.name }}</strong>
              <span>{{ d.score }} / {{ d.max }}</span>
            </div>
            <p>{{ d.comment }}</p>
          </div>
        </div>
        <div class="score-lists">
          <div>
            <strong>优点</strong>
            <ul>
              <li v-for="(s, i) in scoreResult.strengths || []" :key="'s' + i">{{ s }}</li>
            </ul>
          </div>
          <div>
            <strong>改进建议</strong>
            <ul>
              <li v-for="(s, i) in scoreResult.improvements || []" :key="'i' + i">{{ s }}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
