<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import {
  extractMarkdownSection,
  firstMarkdownHeading,
  listEssayGuideHistory,
  polishEssay,
  scoreEssay,
  streamEssayGuide,
  type EssayGuideHistoryRecord,
  type EssayScoreResponse,
  type PolishPart,
} from '../api/essayAi'
import { compressImageDataUrl, type CaseImage } from '../api/caseAi'
import {
  buildEssayMarkdown,
  countExamWords,
  extractEssayTitle,
  formatDate,
  joinTopic,
  parseEssayMarkdown,
  sanitizeEssayParts,
  splitTopic,
  stripCaseTopicText,
} from '../utils/exam'
import { collectAssetPaths, markdownToHtml } from '../utils/markdown'
import MarkdownRichEditor from './MarkdownRichEditor.vue'
import EssayThinkingBox from './EssayThinkingBox.vue'
import PolishDiffModal from './PolishDiffModal.vue'

const props = defineProps<{
  fileName: string
  isNew: boolean
}>()

const emit = defineEmits<{
  created: [fileName: string]
  deleted: []
}>()

const store = useAppStore()
const topic = ref('')
const abstractText = ref('')
const body = ref('')
const currentName = ref('')
const dirty = ref(false)
const status = ref('')
const aiLoading = ref('')
const scoreOpen = ref(false)
const scoreResult = ref<EssayScoreResponse | null>(null)
const polishOpen = ref(false)
const polishTitle = ref('确认 AI 润色')
const polishSections = ref<{ label: string; from: string; to: string }[]>([])
const polishPending = ref<{ abstract: string; body: string } | null>(null)
const guideHistory = ref<EssayGuideHistoryRecord[]>([])
const guideMarkdown = ref('')
const guideThinking = ref('')
const selectedGuideId = ref('')
const draftHistoryKey = ref('')
const guideStreamEl = ref<HTMLElement | null>(null)
const guideCollapsed = ref(false)
const historyCollapsed = ref(false)
const generatingGuide = ref(false)
let guideAbort: AbortController | null = null
const editorKey = ref(0)

const media = computed(() =>
  store.rootPath
    ? {
        rootPath: store.rootPath,
        subjectId: store.subjectId,
        kind: 'essays' as const,
      }
    : null,
)

/** 摘要 300 字以内；正文约 2000~2500 */
const ABSTRACT_MAX = 300
const BODY_MIN = 2000
const BODY_MAX = 2500

const topicTitle = computed(() => extractEssayTitle(topic.value) || splitTopic(stripCaseTopicText(topic.value)).title)
const abstractCount = computed(() => countExamWords(abstractText.value))
const bodyCount = computed(() => countExamWords(body.value))
const totalCount = computed(() => abstractCount.value + bodyCount.value)

const abstractClass = computed(() => {
  const n = abstractCount.value
  if (n === 0) return ''
  if (n > ABSTRACT_MAX) return 'warn'
  if (n >= 200) return 'ok'
  return ''
})

const bodyClass = computed(() => {
  const n = bodyCount.value
  if (n === 0) return ''
  if (n >= BODY_MIN && n <= BODY_MAX) return 'ok'
  if (n > BODY_MAX || (n > 0 && n < 1600)) return 'warn'
  return ''
})

const historyFileName = computed(() => currentName.value || draftHistoryKey.value)

const guideHtml = computed(() =>
  guideMarkdown.value.trim() ? markdownToHtml(guideMarkdown.value) : '',
)
const abstractDraft = computed(() => extractMarkdownSection(guideMarkdown.value, '摘要草稿'))
const bodyOutline = computed(() => extractMarkdownSection(guideMarkdown.value, '正文提纲'))
const recognizedTopic = computed(
  () => firstMarkdownHeading(guideMarkdown.value) || topicTitle.value,
)

async function load(): Promise<void> {
  if (!generatingGuide.value) {
    abortGuideStream()
  }
  if (props.isNew || !props.fileName) {
    topic.value = ''
    abstractText.value = ''
    body.value = ''
    currentName.value = ''
    dirty.value = false
    draftHistoryKey.value = `draft-${Date.now()}`
    guideHistory.value = []
    guideMarkdown.value = ''
    guideThinking.value = ''
    selectedGuideId.value = ''
    status.value = '新建论文练习：题目区可粘贴试卷截图'
    editorKey.value += 1
    return
  }
  const note = await window.api.readNote(
    store.rootPath,
    store.subjectId,
    'essays',
    props.fileName,
  )
  const parsed = parseEssayMarkdown(note.content)
  const cleaned = sanitizeEssayParts(parsed)
  topic.value = joinTopic(cleaned.title, cleaned.prompt)
  abstractText.value = cleaned.abstract
  body.value = cleaned.body
  currentName.value = note.fileName
  dirty.value = false
  draftHistoryKey.value = ''
  guideMarkdown.value = ''
  guideThinking.value = ''
  selectedGuideId.value = ''
  await loadGuideHistory(note.fileName)
  status.value = guideHistory.value.length
    ? `已打开 ${note.fileName} · ${guideHistory.value.length} 条论文指导`
    : `已打开 ${note.fileName}`
  editorKey.value += 1
}

async function loadGuideHistory(fileName: string): Promise<void> {
  if (!fileName) {
    guideHistory.value = []
    return
  }
  try {
    const records = await listEssayGuideHistory(store.subjectId, fileName)
    guideHistory.value = records
    if (!guideMarkdown.value && records.length) {
      selectGuide(records[0])
    }
  } catch (e) {
    guideHistory.value = []
    status.value = e instanceof Error ? e.message : '读取指导历史失败'
  }
}

function selectGuide(rec: EssayGuideHistoryRecord): void {
  if (aiLoading.value === 'guide') return
  selectedGuideId.value = rec.id
  guideMarkdown.value = rec.markdown || ''
  guideThinking.value = rec.thinking || ''
}

function abortGuideStream(): void {
  if (guideAbort) {
    guideAbort.abort()
    guideAbort = null
  }
}

async function scrollGuideToBottom(): Promise<void> {
  await nextTick()
  const el = guideStreamEl.value
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
  const title = extractEssayTitle(topic.value) || splitTopic(stripCaseTopicText(topic.value)).title
  if (!title) {
    status.value = '请先填写论文题目（题目区首行文字作为题目名称）'
    return
  }
  store.saving = true
  try {
    const cleaned = sanitizeEssayParts({
      title,
      prompt: topic.value.trim(),
      abstract: abstractText.value,
      body: body.value,
    })
    // 写回界面，去掉误带入的 ## 摘要 / ## 正文 等污染
    topic.value = joinTopic(cleaned.title, cleaned.prompt)
    abstractText.value = cleaned.abstract
    body.value = cleaned.body

    const absCount = countExamWords(cleaned.abstract)
    if (absCount > ABSTRACT_MAX) {
      status.value = `摘要超出 ${ABSTRACT_MAX} 字上限（当前 ${absCount}）`
      store.saving = false
      return
    }

    const content = buildEssayMarkdown({
      title: cleaned.title,
      prompt: topic.value.trim(),
      abstract: cleaned.abstract,
      body: cleaned.body,
    })
    const meta = await window.api.writeNote({
      rootPath: store.rootPath,
      subjectId: store.subjectId,
      kind: 'essays',
      fileName: currentName.value,
      content,
      title: cleaned.title,
    })
    currentName.value = meta.fileName
    dirty.value = false
    await loadGuideHistory(currentName.value)
    status.value = guideHistory.value.length
      ? `已保存 ${meta.fileName} · ${guideHistory.value.length} 条论文指导`
      : `已保存 ${meta.fileName}`
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
  const name = topicTitle.value || currentName.value
  if (!confirm(`确认删除论文「${name}」？`)) return
  await window.api.deleteNote(
    store.rootPath,
    store.subjectId,
    'essays',
    currentName.value,
  )
  await store.refreshList()
  emit('deleted')
}

function buildAiPayload(part: PolishPart) {
  return {
    subject: store.subject.name,
    topic: stripCaseTopicText(topic.value).trim() || extractEssayTitle(topic.value),
    part,
    abstractText: abstractText.value,
    bodyText: body.value,
  }
}

async function collectTopicImages(): Promise<CaseImage[]> {
  if (!media.value) return []
  const paths = collectAssetPaths(topic.value).slice(0, 8)
  const images: CaseImage[] = []
  for (const rel of paths) {
    const dataUrl = await window.api.readImageDataUrl({
      rootPath: media.value.rootPath,
      subjectId: media.value.subjectId,
      kind: 'essays',
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

async function runGuide(): Promise<void> {
  abortGuideStream()
  guideCollapsed.value = false
  generatingGuide.value = true
  aiLoading.value = 'guide'
  status.value = '正在识题并流式生成论文指导…'
  try {
    const images = await collectTopicImages()
    const topicText = stripCaseTopicText(topic.value)
    if (!images.length && !topicText.trim()) {
      status.value = '请先填写题目或粘贴题目截图'
      return
    }
    if (!draftHistoryKey.value && !currentName.value) {
      draftHistoryKey.value = `draft-${Date.now()}`
    }
    guideMarkdown.value = ''
    guideThinking.value = ''
    selectedGuideId.value = ''
    const controller = new AbortController()
    guideAbort = controller
    const rec = await streamEssayGuide(
      {
        subject: store.subject.name,
        subjectId: store.subjectId,
        fileName: historyFileName.value,
        topic: topicText,
        abstractText: abstractText.value,
        bodyText: body.value,
        images,
      },
      (chunk) => {
        guideMarkdown.value = chunk.markdown
        guideThinking.value = chunk.thinking
        void scrollGuideToBottom()
      },
      controller.signal,
    )
    selectedGuideId.value = rec.id
    if (rec.topic && !extractEssayTitle(topic.value)) {
      topic.value = `${rec.topic}\n\n${topic.value}`.trim()
      dirty.value = true
    }
    await loadGuideHistory(historyFileName.value)
    status.value = '论文指导已写入历史'
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      status.value = '已停止生成指导'
      return
    }
    status.value = e instanceof Error ? e.message : '指导失败'
  } finally {
    if (guideAbort && !guideAbort.signal.aborted) {
      guideAbort = null
    }
    aiLoading.value = ''
    generatingGuide.value = false
  }
}

function applyAbstractDraft(): void {
  const draft = abstractDraft.value
  if (!draft) return
  if (abstractText.value.trim() && !confirm('将覆盖当前摘要，是否继续？')) return
  abstractText.value = draft
  dirty.value = true
  status.value = '已写入摘要草稿，请按自己的项目改写后保存'
}

function applyBodyOutline(): void {
  const outline = bodyOutline.value
  if (!outline) return
  if (body.value.trim() && !confirm('将覆盖当前正文，是否继续？')) return
  body.value = outline
  dirty.value = true
  status.value = '已写入正文提纲，请按项目举例展开成文'
}

async function runPolish(part: PolishPart): Promise<void> {
  if (!extractEssayTitle(topic.value) && !stripCaseTopicText(topic.value).trim()) {
    status.value = '请先填写论文题目'
    return
  }
  if (part === 'abstract' && !abstractText.value.trim()) {
    status.value = '摘要为空，无法润色'
    return
  }
  if (part === 'body' && !body.value.trim()) {
    status.value = '正文为空，无法润色'
    return
  }
  if (part === 'all' && !abstractText.value.trim() && !body.value.trim()) {
    status.value = '摘要和正文都为空，无法润色'
    return
  }
  aiLoading.value = part
  status.value = 'AI 润色中…'
  try {
    const res = await polishEssay(buildAiPayload(part))
    const cleaned = sanitizeEssayParts({
      title: splitTopic(topic.value).title || '未命名论文',
      prompt: topic.value.trim(),
      abstract:
        part === 'abstract' || part === 'all'
          ? res.abstractText || abstractText.value
          : abstractText.value,
      body:
        part === 'body' || part === 'all'
          ? res.bodyText || body.value
          : body.value,
    })
    const sections: { label: string; from: string; to: string }[] = []
    if (part === 'abstract' || part === 'all') {
      sections.push({
        label: '摘要',
        from: abstractText.value,
        to: cleaned.abstract,
      })
    }
    if (part === 'body' || part === 'all') {
      sections.push({
        label: '正文',
        from: body.value,
        to: cleaned.body,
      })
    }
    polishPending.value = { abstract: cleaned.abstract, body: cleaned.body }
    polishSections.value = sections
    polishTitle.value =
      part === 'abstract' ? '确认润色摘要' : part === 'body' ? '确认润色正文' : '确认润色摘要与正文'
    polishOpen.value = true
    status.value = 'AI 润色完成，请确认是否接受'
  } catch (e) {
    status.value = e instanceof Error ? e.message : '润色失败'
  } finally {
    aiLoading.value = ''
  }
}

function acceptPolish(): void {
  const pending = polishPending.value
  if (pending) {
    abstractText.value = pending.abstract
    body.value = pending.body
    dirty.value = true
    status.value = '已接受 AI 润色，请检查后保存'
  }
  closePolish()
}

function rejectPolish(): void {
  status.value = '已放弃本次润色，原文未改'
  closePolish()
}

function closePolish(): void {
  polishOpen.value = false
  polishPending.value = null
  polishSections.value = []
}

async function runScore(): Promise<void> {
  if (!extractEssayTitle(topic.value) && !stripCaseTopicText(topic.value).trim()) {
    status.value = '请先填写论文题目'
    return
  }
  if (!abstractText.value.trim() && !body.value.trim()) {
    status.value = '请先写完摘要或正文再评分'
    return
  }
  aiLoading.value = 'score'
  status.value = 'AI 评分中…'
  try {
    const res = await scoreEssay({
      subject: store.subject.name,
      topic: stripCaseTopicText(topic.value).trim() || extractEssayTitle(topic.value),
      abstractText: abstractText.value,
      bodyText: body.value,
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
  abortGuideStream()
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
        <button
          class="btn light"
          :disabled="!!aiLoading"
          @click="runPolish('abstract')"
        >
          {{ aiLoading === 'abstract' ? '润色中…' : '润色摘要' }}
        </button>
        <button
          class="btn light"
          :disabled="!!aiLoading"
          @click="runPolish('body')"
        >
          {{ aiLoading === 'body' ? '润色中…' : '润色正文' }}
        </button>
        <button
          class="btn light"
          :disabled="!!aiLoading"
          @click="runPolish('all')"
        >
          {{ aiLoading === 'all' ? '润色中…' : '润色全部' }}
        </button>
        <button
          class="btn"
          :disabled="!!aiLoading"
          @click="runScore"
        >
          {{ aiLoading === 'score' ? '评分中…' : 'AI 评分' }}
        </button>
        <button class="btn" :disabled="store.saving || !!aiLoading" @click="save">
          保存
        </button>
        <button class="btn danger" :disabled="!!aiLoading" @click="remove">删除</button>
        <button
          class="btn light"
          type="button"
          :title="guideCollapsed ? '展开论文指导' : '收起论文指导'"
          @click="toggleGuide"
        >
          {{ guideCollapsed ? '显示指导' : '隐藏指导' }}
        </button>
      </div>
    </div>

    <div class="essay-stack">
      <div class="essay-panel essay-panel--topic">
        <div class="panel-head">
          <strong>论文题目</strong>
          <span class="status">首行文字作题目名称；可粘贴试卷截图，模型识图后给指导</span>
        </div>
        <div class="field essay-topic-editor">
          <MarkdownRichEditor
            :key="editorKey"
            v-model="topic"
            :media="media"
            placeholder="论大模型智能运维技术及应用&#10;&#10;可在此粘贴题目截图，或继续写题目背景与三点要求…"
            @change="markDirty"
          />
        </div>
      </div>

      <div class="essay-panel essay-panel--abstract">
        <div class="panel-head">
          <strong>摘要</strong>
          <span class="status" :class="{ warn: abstractCount > ABSTRACT_MAX }">
            {{ abstractCount }} / {{ ABSTRACT_MAX }} 字以内
          </span>
        </div>
        <div class="field">
          <textarea
            v-model="abstractText"
            placeholder="写清项目背景、角色、技术路线与效果…"
            @input="markDirty"
          />
        </div>
      </div>

      <div class="essay-panel essay-panel--body">
        <div class="panel-head">
          <strong>正文</strong>
          <span class="status">建议 {{ BODY_MIN }}–{{ BODY_MAX }} 字</span>
        </div>
        <div class="field">
          <textarea
            v-model="body"
            placeholder="按论文结构展开：项目介绍、问题与对策、总结…"
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
        title="展开论文指导"
        @click="toggleGuide"
      >
        <span>论文指导</span>
      </button>
      <div class="guide-board-head">
        <div class="guide-board-title">
          <strong>论文指导</strong>
          <span class="status">
            {{
              aiLoading === 'guide'
                ? '正在流式生成…'
                : recognizedTopic || '按题目生成写作方案'
            }}
          </span>
        </div>
        <div class="actions">
          <button
            class="btn"
            :disabled="!!aiLoading"
            @click="runGuide"
          >
            {{ aiLoading === 'guide' ? '生成中…' : '生成指导' }}
          </button>
          <button
            v-if="abstractDraft"
            class="btn light"
            :disabled="aiLoading === 'guide'"
            @click="applyAbstractDraft"
          >
            写入摘要草稿
          </button>
          <button
            v-if="bodyOutline"
            class="btn light"
            :disabled="aiLoading === 'guide'"
            @click="applyBodyOutline"
          >
            写入正文提纲
          </button>
          <button
            class="pane-toggle"
            type="button"
            title="收起论文指导"
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
              v-for="rec in guideHistory"
              :key="rec.id"
              class="guide-history-item"
              :class="{ active: rec.id === selectedGuideId }"
              :disabled="aiLoading === 'guide'"
              @click="selectGuide(rec)"
            >
              <span class="guide-history-topic">{{ rec.topic || recognizedTopic || '论文指导' }}</span>
              <span class="guide-history-time">{{ formatDate(rec.createdAt) }}</span>
            </button>
            <div v-if="!guideHistory.length" class="guide-history-empty">
              生成后会记入会话历史，下次打开还能看
            </div>
          </div>
        </div>
        <div ref="guideStreamEl" class="guide-stream">
          <EssayThinkingBox
            :thinking="guideThinking"
            :loading="aiLoading === 'guide'"
          />
          <pre
            v-if="guideMarkdown && aiLoading === 'guide'"
            class="guide-stream-raw"
          >{{ guideMarkdown }}</pre>
          <div v-else-if="guideHtml" class="guide-md" v-html="guideHtml" />
          <span v-if="aiLoading === 'guide' && guideMarkdown" class="guide-caret" />
          <div v-else-if="!guideMarkdown && !guideThinking && aiLoading !== 'guide'" class="guide-empty">
            在左侧填写或粘贴题目截图，点「生成指导」。思考会收进上方思考框，指导正文会边生成边出现。
          </div>
        </div>
      </div>
    </aside>

    <div class="word-bar">
      <span class="word-chip" :class="abstractClass">
        摘要 <b>{{ abstractCount }}</b>
        <template v-if="abstractCount > ABSTRACT_MAX">（超限）</template>
      </span>
      <span class="word-chip" :class="bodyClass">
        正文 <b>{{ bodyCount }}</b>
      </span>
      <span class="word-chip">
        写作合计 <b>{{ totalCount }}</b>
      </span>
      <span class="status">
        统计规则：一个整词算 1 字；词间加空格后计 2；标点算 1 字
      </span>
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

    <PolishDiffModal
      :open="polishOpen"
      :title="polishTitle"
      :sections="polishSections"
      @accept="acceptPolish"
      @reject="rejectPolish"
    />

  </div>
</template>
