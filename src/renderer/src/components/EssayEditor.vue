<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import {
  buildEssayMarkdown,
  countExamWords,
  parseEssayMarkdown,
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
const title = ref('')
const prompt = ref('')
const abstractText = ref('')
const body = ref('')
const currentName = ref('')
const dirty = ref(false)
const status = ref('')

/** 摘要 300 字以内；正文约 2000~2500 */
const ABSTRACT_MAX = 300
const BODY_MIN = 2000
const BODY_MAX = 2500

const abstractCount = computed(() => countExamWords(abstractText.value))
const bodyCount = computed(() => countExamWords(body.value))
const totalCount = computed(
  () => abstractCount.value + bodyCount.value,
)

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
    title.value = ''
    prompt.value = ''
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
  title.value = parsed.title
  prompt.value = parsed.prompt
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
  if (!title.value.trim()) {
    status.value = '请先填写题目名称'
    return
  }
  if (abstractCount.value > ABSTRACT_MAX) {
    status.value = `摘要超出 ${ABSTRACT_MAX} 字上限（当前 ${abstractCount.value}）`
    return
  }
  store.saving = true
  try {
    const content = buildEssayMarkdown({
      title: title.value,
      prompt: prompt.value,
      abstract: abstractText.value,
      body: body.value,
    })
    const meta = await window.api.writeNote({
      rootPath: store.rootPath,
      subjectId: store.subjectId,
      kind: 'essays',
      fileName: currentName.value,
      content,
      title: title.value.trim(),
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
  if (!confirm(`确认删除论文「${title.value || currentName.value}」？`)) return
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
        <strong>论文题目</strong>
        <div class="field">
          <label>题目名称</label>
          <input
            v-model="title"
            placeholder="例如：论大模型智能运维技术及应用"
            @input="markDirty"
          />
        </div>
        <div class="field">
          <label>题目描述</label>
          <textarea
            v-model="prompt"
            class="prompt-area"
            placeholder="粘贴考试题目背景、写作要求等大段文字…"
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
