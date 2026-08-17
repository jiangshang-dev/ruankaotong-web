<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import {
  compressImageDataUrl,
  scoreCase,
  solveCase,
  type CaseImage,
  type CaseScoreResponse,
  type CaseSolveResponse,
} from '../api/caseAi'
import {
  buildCaseMarkdown,
  countExamWords,
  parseCaseMarkdown,
  stripCaseTopicText,
} from '../utils/exam'
import { collectAssetPaths } from '../utils/markdown'
import MarkdownRichEditor from './MarkdownRichEditor.vue'

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
const solveOpen = ref(false)
const solveResult = ref<CaseSolveResponse | null>(null)

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

async function load(): Promise<void> {
  if (props.isNew || !props.fileName) {
    title.value = ''
    topic.value = ''
    answer.value = ''
    currentName.value = ''
    dirty.value = false
    status.value = '新建案例分析：上方粘贴题目截图，下方按题号作答'
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
  status.value = `已打开 ${note.fileName}`
  editorKey.value += 1
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

async function buildAiPayload() {
  const images = await collectImages()
  return {
    subject: store.subject.name,
    title: title.value.trim(),
    topicText: stripCaseTopicText(topic.value),
    images,
  }
}

async function runSolve(): Promise<void> {
  aiLoading.value = 'solve'
  status.value = '正在识图解答…'
  try {
    const payload = await buildAiPayload()
    if (!payload.images.length && !payload.topicText) {
      status.value = '请先在上方粘贴题目截图'
      return
    }
    const res = await solveCase(payload)
    solveResult.value = res
    solveOpen.value = true
    status.value = 'AI 解答完成，可对照后写入答案框'
  } catch (e) {
    status.value = e instanceof Error ? e.message : '解答失败'
  } finally {
    aiLoading.value = ''
  }
}

function applySolveAnswer(): void {
  const text = solveResult.value?.answerText?.trim()
  if (!text) return
  if (answer.value.trim() && !confirm('将覆盖当前答案，是否继续？')) return
  answer.value = text
  dirty.value = true
  solveOpen.value = false
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
    const payload = await buildAiPayload()
    if (!payload.images.length && !payload.topicText) {
      status.value = '请先在上方粘贴题目截图'
      return
    }
    const res = await scoreCase({
      ...payload,
      answerText: answer.value,
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
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="essay-layout">
    <div class="editor-toolbar" style="padding: 0; border: none">
      <div class="status">{{ status }}{{ dirty ? ' · 未保存' : '' }}</div>
      <div class="actions">
        <button class="btn light" :disabled="!!aiLoading" @click="runSolve">
          {{ aiLoading === 'solve' ? '识图中…' : 'AI 解答' }}
        </button>
        <button class="btn" :disabled="!!aiLoading" @click="runScore">
          {{ aiLoading === 'score' ? '评分中…' : 'AI 评分' }}
        </button>
        <button class="btn" :disabled="store.saving || !!aiLoading" @click="save">
          保存
        </button>
        <button class="btn danger" :disabled="!!aiLoading" @click="remove">删除</button>
      </div>
    </div>

    <div class="essay-stack">
      <div class="essay-panel essay-panel--question">
        <div class="panel-head">
          <strong>题目</strong>
          <span class="status">粘贴试卷截图，模型将识图作答；可补少量文字说明</span>
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

    <div class="word-bar">
      <span class="word-chip">
        作答 <b>{{ answerCount }}</b>
      </span>
      <span class="status">截图粘贴后可点「AI 解答」对照，或自己写完后「AI 评分」</span>
    </div>

    <div v-if="solveOpen && solveResult" class="score-modal-mask" @click.self="solveOpen = false">
      <div class="score-modal">
        <div class="score-modal-head">
          <h3>AI 参考答案</h3>
          <div class="actions">
            <button class="btn" @click="applySolveAnswer">写入答案框</button>
            <button class="btn light" @click="solveOpen = false">关闭</button>
          </div>
        </div>
        <p v-if="solveResult.title" class="case-solve-title">{{ solveResult.title }}</p>
        <div v-if="solveResult.questions?.length" class="score-dims">
          <div
            v-for="(q, i) in solveResult.questions"
            :key="i"
            class="score-dim"
          >
            <div class="score-dim-top">
              <strong>{{ q.questionNo || `问题${i + 1}` }}</strong>
            </div>
            <p v-if="q.stem">{{ q.stem }}</p>
            <pre class="case-answer-pre">{{ q.answer }}</pre>
          </div>
        </div>
        <pre v-else class="case-answer-pre">{{ solveResult.answerText || solveResult.raw }}</pre>
      </div>
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
