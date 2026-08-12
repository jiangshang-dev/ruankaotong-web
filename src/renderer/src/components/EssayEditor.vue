<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
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
        <button class="btn" :disabled="store.saving" @click="save">保存</button>
        <button class="btn danger" @click="remove">删除</button>
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
  </div>
</template>
