<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import {
  polishEssay,
  scoreEssay,
  type EssayScoreResponse,
  type PolishPart,
} from '../api/essayAi'
import {
  buildEssayMarkdown,
  countExamWords,
  joinTopic,
  parseEssayMarkdown,
  splitTopic,
} from '../utils/exam'

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

/** 摘要 300 字以内；正文约 2000~2500 */
const ABSTRACT_MAX = 300
const BODY_MIN = 2000
const BODY_MAX = 2500

const topicTitle = computed(() => splitTopic(topic.value).title)
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

async function load(): Promise<void> {
  if (props.isNew || !props.fileName) {
    topic.value = ''
    abstractText.value = ''
    body.value = ''
    currentName.value = ''
    dirty.value = false
    status.value = '新建论文练习'
    return
  }
  const note = await window.api.readNote(
    store.rootPath,
    store.subjectId,
    'essays',
    props.fileName,
  )
  const parsed = parseEssayMarkdown(note.content)
  topic.value = joinTopic(parsed.title, parsed.prompt)
  abstractText.value = parsed.abstract
  body.value = parsed.body
  currentName.value = note.fileName
  dirty.value = false
  status.value = `已打开 ${note.fileName}`
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
  const { title } = splitTopic(topic.value)
  if (!title) {
    status.value = '请先填写论文题目（首行作为题目名称）'
    return
  }
  if (abstractCount.value > ABSTRACT_MAX) {
    status.value = `摘要超出 ${ABSTRACT_MAX} 字上限（当前 ${abstractCount.value}）`
    return
  }
  store.saving = true
  try {
    const content = buildEssayMarkdown({
      title,
      prompt: topic.value.trim(),
      abstract: abstractText.value,
      body: body.value,
    })
    const meta = await window.api.writeNote({
      rootPath: store.rootPath,
      subjectId: store.subjectId,
      kind: 'essays',
      fileName: currentName.value,
      content,
      title,
    })
    currentName.value = meta.fileName
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
    topic: topic.value.trim(),
    part,
    abstractText: abstractText.value,
    bodyText: body.value,
  }
}

async function runPolish(part: PolishPart): Promise<void> {
  if (!topic.value.trim()) {
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
    if (part === 'abstract' || part === 'all') {
      abstractText.value = res.abstractText || abstractText.value
    }
    if (part === 'body' || part === 'all') {
      body.value = res.bodyText || body.value
    }
    dirty.value = true
    status.value = 'AI 润色完成，请检查后保存'
  } catch (e) {
    status.value = e instanceof Error ? e.message : '润色失败'
  } finally {
    aiLoading.value = ''
  }
}

async function runScore(): Promise<void> {
  if (!topic.value.trim()) {
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
      topic: topic.value.trim(),
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
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="essay-layout">
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
      </div>
    </div>

    <div class="essay-stack">
      <div class="essay-panel essay-panel--topic">
        <div class="panel-head">
          <strong>论文题目</strong>
          <span class="status">首行作题目名称，下方粘贴题目描述与要求</span>
        </div>
        <div class="field">
          <textarea
            v-model="topic"
            class="prompt-area"
            placeholder="论大模型智能运维技术及应用&#10;&#10;近年来，大模型技术快速发展……&#10;&#10;请以「论大模型智能运维技术及应用」为题，依次论述以下三个方面：&#10;1. 简要叙述你参与的软件开发项目……"
            @input="markDirty"
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
  </div>
</template>
