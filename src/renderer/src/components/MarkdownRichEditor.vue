<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  buildImageHtml,
  collectAssetPaths,
  htmlToMarkdown,
  markdownToHtmlWithImages,
  plainTextFromHtml,
} from '../utils/markdown'

export type MediaContext = {
  rootPath: string
  subjectId: string
  kind: 'notes' | 'essays' | 'cases'
}

const props = defineProps<{
  modelValue: string
  placeholder?: string
  media?: MediaContext | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
}>()

const editorRef = ref<HTMLDivElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)
const fontSize = ref('16px')
const syncing = ref(false)
const pasting = ref(false)
const selectedImg = ref<HTMLImageElement | null>(null)
const handlePos = ref({ top: 0, left: 0, width: 0, height: 0 })
const resizing = ref(false)

const selectedWidth = computed(() => {
  const img = selectedImg.value
  if (!img) return 0
  return Math.round(img.getBoundingClientRect().width)
})

function emitMarkdown(): void {
  if (!editorRef.value) return
  const md = htmlToMarkdown(editorRef.value.innerHTML)
  emit('update:modelValue', md)
  emit('change')
}

async function resolveDataUrls(md: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  if (!props.media?.rootPath) return map
  const paths = collectAssetPaths(md)
  await Promise.all(
    paths.map(async (rel) => {
      const dataUrl = await window.api.readImageDataUrl({
        rootPath: props.media!.rootPath,
        subjectId: props.media!.subjectId,
        kind: props.media!.kind,
        relativePath: rel,
      })
      if (dataUrl) map[rel] = dataUrl
    }),
  )
  return map
}

function clearImageSelection(): void {
  selectedImg.value?.classList.remove('is-selected')
  selectedImg.value = null
}

function updateHandlePos(): void {
  const img = selectedImg.value
  const wrap = wrapRef.value
  if (!img || !wrap) return
  const ir = img.getBoundingClientRect()
  const wr = wrap.getBoundingClientRect()
  handlePos.value = {
    top: ir.top - wr.top + wrap.scrollTop,
    left: ir.left - wr.left + wrap.scrollLeft,
    width: ir.width,
    height: ir.height,
  }
}

function selectImage(img: HTMLImageElement): void {
  if (selectedImg.value !== img) {
    clearImageSelection()
    selectedImg.value = img
    img.classList.add('is-selected')
  }
  updateHandlePos()
}

function isEditorVisuallyEmpty(el: HTMLElement): boolean {
  if (el.querySelector('img, table, hr, pre, video')) return false
  const text = (el.textContent || '').replace(/\u200b/g, '').trim()
  if (text) return false
  // 无可见文字时，仅含空块 / br 也视为空（含多个 <p><br></p>）
  const html = el.innerHTML
    .replace(/&nbsp;/gi, '')
    .replace(/\s+/g, '')
    .toLowerCase()
  if (!html || html === '<br>') return true
  return /^(<(?:p|div)>(?:<br\s*\/?>)?<\/(?:p|div)>|<br\s*\/?>)+$/.test(html)
}

/** 空编辑器统一成单个 <br>，避免 <p><br></p> 造成「第二行」光标 */
function normalizeEmptyEditor(el: HTMLElement): void {
  if (!isEditorVisuallyEmpty(el)) return
  if (el.innerHTML !== '<br>') {
    el.innerHTML = '<br>'
  }
}

/** 将光标放到正文第一行开头（插在 <br> 之前，而不是之后） */
function placeCaretAtStart(el: HTMLElement): void {
  normalizeEmptyEditor(el)
  el.focus()
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()

  try {
    const first = el.firstChild
    if (first?.nodeName === 'BR') {
      range.setStartBefore(first)
    } else if (first?.nodeType === Node.ELEMENT_NODE) {
      const block = first as HTMLElement
      const br = block.querySelector('br')
      if (br) range.setStartBefore(br)
      else if (block.firstChild?.nodeType === Node.TEXT_NODE) {
        range.setStart(block.firstChild, 0)
      } else {
        range.setStart(block, 0)
      }
    } else if (first?.nodeType === Node.TEXT_NODE) {
      range.setStart(first, 0)
    } else {
      range.selectNodeContents(el)
      range.collapse(true)
    }
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  } catch {
    range.selectNodeContents(el)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

function focusEditor(atStart = false): void {
  const el = editorRef.value
  if (!el) return
  if (atStart || isEditorVisuallyEmpty(el)) {
    placeCaretAtStart(el)
  } else {
    el.focus()
  }
}

async function setHtmlFromMarkdown(md: string): Promise<void> {
  if (!editorRef.value) return
  clearImageSelection()
  syncing.value = true
  try {
    const map = await resolveDataUrls(md)
    const html = markdownToHtmlWithImages(md, map)
    editorRef.value.innerHTML = html
    if (isEditorVisuallyEmpty(editorRef.value)) {
      normalizeEmptyEditor(editorRef.value)
    }
  } finally {
    await nextTick()
    syncing.value = false
    if (editorRef.value && isEditorVisuallyEmpty(editorRef.value)) {
      placeCaretAtStart(editorRef.value)
    }
  }
}

watch(
  () => props.modelValue,
  (md) => {
    if (!editorRef.value || syncing.value || pasting.value || resizing.value) return
    const current = htmlToMarkdown(editorRef.value.innerHTML)
    if (current === md.trim()) return
    void setHtmlFromMarkdown(md)
  },
)

onMounted(() => {
  void setHtmlFromMarkdown(props.modelValue).then(() => {
    if (editorRef.value && isEditorVisuallyEmpty(editorRef.value)) {
      placeCaretAtStart(editorRef.value)
    }
  })
  window.addEventListener('resize', updateHandlePos)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateHandlePos)
  stopResizeListeners()
})

function scheduleCaretAtStart(el: HTMLElement): void {
  // 双 rAF：覆盖 Chrome focus 后把光标挪到 <br> 后面的默认行为
  requestAnimationFrame(() => {
    requestAnimationFrame(() => placeCaretAtStart(el))
  })
}

function onEditorFocus(): void {
  const el = editorRef.value
  if (el && isEditorVisuallyEmpty(el)) {
    scheduleCaretAtStart(el)
  }
}

function onEditorClick(e: MouseEvent): void {
  const target = e.target
  if (target instanceof HTMLImageElement) {
    e.preventDefault()
    selectImage(target)
    return
  }
  clearImageSelection()
  const el = editorRef.value
  if (el && isEditorVisuallyEmpty(el)) {
    scheduleCaretAtStart(el)
  }
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
  if (syncing.value || resizing.value) return
  emitMarkdown()
  if (selectedImg.value) updateHandlePos()
}

function applyImgWidth(img: HTMLImageElement, width: number): void {
  const max = editorRef.value?.clientWidth
    ? editorRef.value.clientWidth - 8
    : width
  const w = Math.max(80, Math.min(Math.round(width), max))
  img.style.width = `${w}px`
  img.style.height = 'auto'
  img.style.maxWidth = '100%'
  img.setAttribute('width', String(w))
  img.setAttribute('data-width', String(w))
  updateHandlePos()
}

function setSelectedPercent(percent: number): void {
  const img = selectedImg.value
  if (!img || !editorRef.value) return
  const max = editorRef.value.clientWidth - 8
  applyImgWidth(img, (max * percent) / 100)
  emitMarkdown()
}

function resetSelectedSize(): void {
  const img = selectedImg.value
  if (!img) return
  img.style.width = ''
  img.style.height = 'auto'
  img.style.maxWidth = '100%'
  img.removeAttribute('width')
  img.removeAttribute('data-width')
  updateHandlePos()
  emitMarkdown()
}

let resizeStartX = 0
let resizeStartW = 0

function onResizeMove(e: MouseEvent): void {
  if (!resizing.value || !selectedImg.value) return
  const delta = e.clientX - resizeStartX
  applyImgWidth(selectedImg.value, resizeStartW + delta)
}

function onResizeUp(): void {
  if (!resizing.value) return
  resizing.value = false
  stopResizeListeners()
  emitMarkdown()
}

function stopResizeListeners(): void {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeUp)
}

function startResize(e: MouseEvent): void {
  if (!selectedImg.value) return
  e.preventDefault()
  e.stopPropagation()
  resizing.value = true
  resizeStartX = e.clientX
  resizeStartW = selectedImg.value.getBoundingClientRect().width
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeUp)
}

function onEditorScroll(): void {
  if (selectedImg.value) updateHandlePos()
}

async function saveAndInsertImage(file: File): Promise<void> {
  if (!props.media?.rootPath) {
    window.alert('请先选择本地笔记目录，再粘贴图片')
    return
  }
  pasting.value = true
  try {
    const buf = new Uint8Array(await file.arrayBuffer())
    const saved = await window.api.saveImage({
      rootPath: props.media.rootPath,
      subjectId: props.media.subjectId,
      kind: props.media.kind,
      bytes: buf,
      mimeType: file.type || 'image/png',
    })
    focusEditor()
    document.execCommand(
      'insertHTML',
      false,
      buildImageHtml(saved.relativePath, saved.dataUrl, file.name || '截图'),
    )
    emitMarkdown()
    await nextTick()
    const imgs = editorRef.value?.querySelectorAll('img[data-md-src]')
    const last = imgs?.[imgs.length - 1]
    if (last instanceof HTMLImageElement) selectImage(last)
  } catch (e) {
    window.alert(e instanceof Error ? e.message : '图片保存失败')
  } finally {
    pasting.value = false
  }
}

function findClipboardImage(e: ClipboardEvent): File | null {
  const items = e.clipboardData?.items
  if (!items) return null
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      return item.getAsFile()
    }
  }
  const files = e.clipboardData?.files
  if (files) {
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) return file
    }
  }
  return null
}

async function onPaste(e: ClipboardEvent): Promise<void> {
  const image = findClipboardImage(e)
  if (image) {
    e.preventDefault()
    await saveAndInsertImage(image)
    return
  }
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') || ''
  document.execCommand('insertText', false, text)
  emitMarkdown()
}

async function onDrop(e: DragEvent): Promise<void> {
  const files = e.dataTransfer?.files
  if (!files?.length) return
  const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
  if (!images.length) return
  e.preventDefault()
  for (const img of images) {
    await saveAndInsertImage(img)
  }
}

function onDragOver(e: DragEvent): void {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
  }
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
      <template v-if="selectedImg">
        <div class="md-sep" />
        <div class="md-group">
          <span class="md-hint">图片 {{ selectedWidth }}px</span>
          <button type="button" title="25% 宽" @click="setSelectedPercent(25)">25%</button>
          <button type="button" title="50% 宽" @click="setSelectedPercent(50)">50%</button>
          <button type="button" title="75% 宽" @click="setSelectedPercent(75)">75%</button>
          <button type="button" title="100% 宽" @click="setSelectedPercent(100)">100%</button>
          <button type="button" title="恢复原始比例宽度" @click="resetSelectedSize">原大</button>
        </div>
      </template>
      <div v-else class="md-sep" />
      <div v-if="!selectedImg" class="md-group">
        <span class="md-hint">截图粘贴 / 点击图片可缩放</span>
      </div>
    </div>

    <div ref="wrapRef" class="md-surface-wrap" @scroll="onEditorScroll">
      <div
        ref="editorRef"
        class="md-surface"
        contenteditable="true"
        spellcheck="false"
        :data-placeholder="placeholder || '在此书写知识点、案例、错题整理…可直接粘贴截图'"
        @input="onInput"
        @paste="onPaste"
        @drop="onDrop"
        @dragover="onDragOver"
        @click="onEditorClick"
        @focus="onEditorFocus"
      />

      <div
        v-if="selectedImg"
        class="img-resize-box"
        :style="{
          top: `${handlePos.top}px`,
          left: `${handlePos.left}px`,
          width: `${handlePos.width}px`,
          height: `${handlePos.height}px`,
        }"
      >
        <span class="img-resize-handle" title="拖动调整大小" @mousedown="startResize" />
      </div>
    </div>
  </div>
</template>
