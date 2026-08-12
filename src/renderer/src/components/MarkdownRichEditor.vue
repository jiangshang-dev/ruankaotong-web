<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { htmlToMarkdown, markdownToHtml, plainTextFromHtml } from '../utils/markdown'

const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
}>()

const editorRef = ref<HTMLDivElement | null>(null)
const fontSize = ref('16px')
const syncing = ref(false)

function emitMarkdown(): void {
  if (!editorRef.value) return
  const md = htmlToMarkdown(editorRef.value.innerHTML)
  emit('update:modelValue', md)
  emit('change')
}

function setHtmlFromMarkdown(md: string): void {
  if (!editorRef.value) return
  syncing.value = true
  editorRef.value.innerHTML = markdownToHtml(md)
  void nextTick(() => {
    syncing.value = false
  })
}

watch(
  () => props.modelValue,
  (md) => {
    if (!editorRef.value || syncing.value) return
    const current = htmlToMarkdown(editorRef.value.innerHTML)
    if (current === md.trim()) return
    setHtmlFromMarkdown(md)
  },
)

onMounted(() => {
  setHtmlFromMarkdown(props.modelValue)
})

function focusEditor(): void {
  editorRef.value?.focus()
}

function run(cmd: string, value?: string): void {
  focusEditor()
  document.execCommand(cmd, false, value)
  emitMarkdown()
}

function formatBlock(tag: string): void {
  focusEditor()
  document.execCommand('formatBlock', false, tag)
  emitMarkdown()
}

function setAlign(align: 'left' | 'center' | 'right' | 'justify'): void {
  const map = {
    left: 'justifyLeft',
    center: 'justifyCenter',
    right: 'justifyRight',
    justify: 'justifyFull',
  } as const
  run(map[align])
}

function applyFontSize(): void {
  focusEditor()
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    document.execCommand(
      'insertHTML',
      false,
      `<span style="font-size:${fontSize.value}">&#8203;</span>`,
    )
  } else {
    const range = sel.getRangeAt(0)
    const span = document.createElement('span')
    span.style.fontSize = fontSize.value
    span.appendChild(range.extractContents())
    range.insertNode(span)
    sel.removeAllRanges()
    const next = document.createRange()
    next.selectNodeContents(span)
    next.collapse(false)
    sel.addRange(next)
  }
  emitMarkdown()
}

function onInput(): void {
  if (syncing.value) return
  emitMarkdown()
}

function onPaste(e: ClipboardEvent): void {
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') || ''
  document.execCommand('insertText', false, text)
  emitMarkdown()
}

defineExpose({
  getPlainText: () =>
    editorRef.value ? plainTextFromHtml(editorRef.value.innerHTML) : '',
  focus: focusEditor,
})
</script>

<template>
  <div class="md-editor">
    <div class="md-toolbar" role="toolbar">
      <div class="md-group">
        <button type="button" title="一级标题" @click="formatBlock('h1')">H1</button>
        <button type="button" title="二级标题" @click="formatBlock('h2')">H2</button>
        <button type="button" title="三级标题" @click="formatBlock('h3')">H3</button>
        <button type="button" title="正文" @click="formatBlock('p')">正文</button>
      </div>
      <div class="md-sep" />
      <div class="md-group">
        <select v-model="fontSize" title="字号" @change="applyFontSize">
          <option value="14px">14</option>
          <option value="16px">16</option>
          <option value="18px">18</option>
          <option value="20px">20</option>
          <option value="24px">24</option>
          <option value="28px">28</option>
        </select>
        <button type="button" title="加粗" @click="run('bold')"><b>B</b></button>
        <button type="button" title="斜体" @click="run('italic')"><i>I</i></button>
        <button type="button" title="下划线" @click="run('underline')"><u>U</u></button>
        <button type="button" title="删除线" @click="run('strikeThrough')">S̶</button>
      </div>
      <div class="md-sep" />
      <div class="md-group">
        <button type="button" title="左对齐" @click="setAlign('left')">左</button>
        <button type="button" title="居中" @click="setAlign('center')">中</button>
        <button type="button" title="右对齐" @click="setAlign('right')">右</button>
      </div>
      <div class="md-sep" />
      <div class="md-group">
        <button type="button" title="无序列表" @click="run('insertUnorderedList')">• 列表</button>
        <button type="button" title="有序列表" @click="run('insertOrderedList')">1. 列表</button>
        <button type="button" title="引用" @click="formatBlock('blockquote')">引用</button>
        <button type="button" title="分隔线" @click="run('insertHorizontalRule')">—</button>
        <button type="button" title="清除格式" @click="run('removeFormat')">清除</button>
      </div>
    </div>

    <div
      ref="editorRef"
      class="md-surface"
      contenteditable="true"
      spellcheck="false"
      :data-placeholder="placeholder || '在此书写知识点、案例、错题整理…'"
      @input="onInput"
      @paste="onPaste"
    />
  </div>
</template>
