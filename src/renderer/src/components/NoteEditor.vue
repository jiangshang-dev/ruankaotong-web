<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { buildNoteMarkdown, countExamWords, parseNoteMarkdown } from '../utils/exam'
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
const body = ref('')
const currentName = ref('')
const dirty = ref(false)
const status = ref('')
const editorKey = ref(0)

const wordCount = computed(() => countExamWords(`${title.value}\n${body.value}`))

async function load(): Promise<void> {
  if (props.isNew || !props.fileName) {
    title.value = ''
    body.value = ''
    currentName.value = ''
    dirty.value = false
    status.value = '新建笔记'
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
  if (!title.value.trim() && !body.value.trim()) {
    status.value = '请先填写标题或内容'
    return
  }
  store.saving = true
  try {
    const content = buildNoteMarkdown(title.value, body.value)
    const meta = await window.api.writeNote({
      rootPath: store.rootPath,
      subjectId: store.subjectId,
      kind: 'notes',
      fileName: currentName.value,
      content,
      title: title.value.trim() || '未命名笔记',
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
  <div class="note-layout">
    <div class="editor-toolbar" style="padding: 0; border: none">
      <div class="status">{{ status }}{{ dirty ? ' · 未保存' : '' }}</div>
      <div class="actions">
        <button class="btn" :disabled="store.saving" @click="save">保存</button>
        <button class="btn danger" @click="remove">删除</button>
      </div>
    </div>

    <div class="field">
      <label>标题</label>
      <input
        v-model="title"
        placeholder="例如：进度管理关键路径"
        @input="markDirty"
      />
    </div>

    <div class="field body">
      <label>正文</label>
      <MarkdownRichEditor
        :key="editorKey"
        v-model="body"
        @change="markDirty"
      />
    </div>

    <div class="word-bar">
      <span class="word-chip">
        字数 <b>{{ wordCount }}</b>
      </span>
      <span class="status">中文按字、英文整词、标点各计 1；保存为 Markdown</span>
    </div>
  </div>
</template>
