<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import NoteEditor from '../components/NoteEditor.vue'
import EssayEditor from '../components/EssayEditor.vue'
import CaseEditor from '../components/CaseEditor.vue'
import LoginModal from '../components/LoginModal.vue'
import ProfileModal from '../components/ProfileModal.vue'
import { formatDate } from '../utils/exam'

const store = useAppStore()
const listCollapsed = ref(false)
const createFlag = ref(false)
const dragFrom = ref('')
const dragOver = ref('')
const didDrag = ref(false)

const kindLabel = computed(() => {
  if (store.kind === 'notes') return '知识点笔记'
  if (store.kind === 'essays') return '论文练习'
  return '案例分析'
})

const kindItemName = computed(() => {
  if (store.kind === 'essays') return '论文'
  if (store.kind === 'cases') return '案例'
  return '笔记'
})

const showEditor = computed(
  () => Boolean(store.currentFile) || createFlag.value,
)

watch(
  () => store.currentFile,
  (v) => {
    if (v) createFlag.value = false
  },
)

watch(
  () => [store.subjectId, store.kind] as const,
  () => {
    createFlag.value = false
  },
)

async function onChooseDir(): Promise<void> {
  await store.chooseWorkspace()
}

async function openFolder(): Promise<void> {
  if (store.rootPath) await window.api.openPath(store.rootPath)
}

function openItem(fileName: string): void {
  if (didDrag.value) {
    didDrag.value = false
    return
  }
  createFlag.value = false
  store.selectFile(fileName)
}

async function startCreate(): Promise<void> {
  if (!store.rootPath) {
    const ok = await store.chooseWorkspace()
    if (!ok) return
  }
  store.selectFile('')
  createFlag.value = true
}

function onCreated(fileName: string): void {
  createFlag.value = false
  store.selectFile(fileName)
}

function onDeleted(): void {
  createFlag.value = false
  store.selectFile('')
}

function onDragStart(e: DragEvent, fileName: string): void {
  dragFrom.value = fileName
  didDrag.value = false
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', fileName)
  }
}

function onDragOver(e: DragEvent, fileName: string): void {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  if (!dragFrom.value || dragFrom.value === fileName) return
  if (dragOver.value === fileName) return
  dragOver.value = fileName
  const fromIndex = store.notes.findIndex((n) => n.fileName === dragFrom.value)
  const toIndex = store.notes.findIndex((n) => n.fileName === fileName)
  if (fromIndex < 0 || toIndex < 0) return
  store.moveNote(fromIndex, toIndex)
  didDrag.value = true
}

async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  dragOver.value = ''
  if (!dragFrom.value) return
  await store.persistNotesOrder()
}

async function onDragEnd(): Promise<void> {
  if (dragFrom.value && didDrag.value) {
    await store.persistNotesOrder()
  }
  dragFrom.value = ''
  dragOver.value = ''
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-top">
        <div class="brand">
          <h1>软考通</h1>
          <p>本地 Markdown 备考笔记</p>
        </div>

        <div class="workspace-box">
          <div class="workspace-path">
            {{ store.rootPath || '尚未选择本地文件夹' }}
          </div>
          <div style="display: flex; gap: 8px; margin-top: 10px">
            <button class="btn" style="flex: 1" @click="onChooseDir">
              {{ store.rootPath ? '更换目录' : '选择目录' }}
            </button>
            <button
              v-if="store.rootPath"
              class="btn ghost"
              title="在访达中打开"
              @click="openFolder"
            >
              打开
            </button>
          </div>
        </div>
      </div>

      <div class="section-label">学科</div>
      <div class="subject-list">
        <button
          v-for="s in store.subjects"
          :key="s.id"
          class="subject-item"
          :class="{ active: store.subjectId === s.id }"
          @click="store.setSubject(s.id)"
        >
          <span class="subject-dot" :style="{ background: s.color }" />
          <span class="subject-meta">
            <strong>{{ s.name }}</strong>
            <span>{{ s.level }} · {{ s.shortName }}</span>
          </span>
        </button>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="topbar-left">
          <h2>{{ store.subject.name }}</h2>
          <span class="pill">{{ store.subject.level }}</span>
        </div>
        <div class="tabs">
          <button
            class="tab"
            :class="{ active: store.kind === 'notes' }"
            @click="store.setKind('notes')"
          >
            知识点笔记
          </button>
          <button
            class="tab"
            :class="{ active: store.kind === 'essays' }"
            @click="store.setKind('essays')"
          >
            论文练习
          </button>
          <button
            class="tab"
            :class="{ active: store.kind === 'cases' }"
            @click="store.setKind('cases')"
          >
            案例分析
          </button>
        </div>
        <div class="account-box">
          <template v-if="store.aiLoggedIn">
            <span class="account-nick" :title="store.clientEmail">{{ store.clientName || '考生' }}</span>
            <button class="btn light" type="button" @click="store.openProfile">个人中心</button>
          </template>
          <button v-else class="btn light" type="button" @click="store.openAiLogin">登录</button>
        </div>
      </header>

      <div v-if="!store.hasWorkspace" class="welcome">
        <div class="welcome-card">
          <h2>开始备考</h2>
          <p>
            无需登录。选择一个本地文件夹作为笔记仓库，所有内容将按学科保存为
            Markdown 文件。
          </p>
          <ul>
            <li>知识点笔记：日常整理考点、案例与错题</li>
            <li>论文练习：题目一个框粘贴；摘要（300 字内）与正文上下排列并实时计字</li>
            <li>案例分析：上方粘贴题目截图，下方按题号作答，支持识图解答与 AI 评分</li>
            <li>知识点笔记：富文本工具栏编辑，保存为 Markdown</li>
            <li>字数规则：整词算 1 字，空格分隔算两词，标点算 1 字</li>
          </ul>
          <button class="btn" @click="onChooseDir">选择本地文件夹</button>
        </div>
      </div>

      <div v-else class="content" :class="{ 'list-collapsed': listCollapsed }">
        <section class="note-list" :class="{ collapsed: listCollapsed }">
          <div class="note-list-head">
            <strong>{{ kindLabel }}</strong>
            <div class="note-list-head-actions">
              <button class="btn light" @click="startCreate">新建</button>
              <button
                class="pane-toggle"
                type="button"
                :title="listCollapsed ? `展开${kindLabel}` : `收起${kindLabel}`"
                @click="listCollapsed = !listCollapsed"
              >
                {{ listCollapsed ? '›' : '‹' }}
              </button>
            </div>
          </div>
          <button
            v-if="listCollapsed"
            class="pane-rail pane-rail--left"
            type="button"
            :title="`展开${kindLabel}`"
            @click="listCollapsed = false"
          >
            <span>{{ kindLabel }}</span>
          </button>
          <div class="note-items">
            <button
              v-if="createFlag && !store.currentFile"
              class="note-item active"
            >
              <strong>新建{{ kindItemName }}</strong>
              <span>尚未保存</span>
            </button>
            <button
              v-for="item in store.notes"
              :key="item.fileName"
              class="note-item"
              :class="{
                active: store.currentFile === item.fileName,
                dragging: dragFrom === item.fileName,
                'drag-over': dragOver === item.fileName && dragFrom !== item.fileName,
              }"
              draggable="true"
              title="拖动可排序"
              @click="openItem(item.fileName)"
              @dragstart="onDragStart($event, item.fileName)"
              @dragover="onDragOver($event, item.fileName)"
              @drop="onDrop"
              @dragend="onDragEnd"
            >
              <strong>{{ item.title }}</strong>
              <span>{{ formatDate(item.updatedAt) }}</span>
            </button>
            <div v-if="!store.notes.length && !createFlag" class="empty-hint">
              还没有内容，点击右上角「新建」开始写。
            </div>
          </div>
        </section>

        <section class="editor-pane">
          <EssayEditor
            v-if="store.kind === 'essays' && showEditor"
            :file-name="store.currentFile"
            :is-new="createFlag && !store.currentFile"
            @created="onCreated"
            @deleted="onDeleted"
          />
          <CaseEditor
            v-else-if="store.kind === 'cases' && showEditor"
            :file-name="store.currentFile"
            :is-new="createFlag && !store.currentFile"
            @created="onCreated"
            @deleted="onDeleted"
          />
          <NoteEditor
            v-else-if="store.kind === 'notes' && showEditor"
            :file-name="store.currentFile"
            :is-new="createFlag && !store.currentFile"
            @created="onCreated"
            @deleted="onDeleted"
          />
          <div v-else class="blank-editor">
            <div>
              <p>
                从左侧选择一篇{{ kindItemName }}，或新建一篇。
              </p>
              <button class="btn" @click="startCreate">新建</button>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
  <LoginModal />
  <ProfileModal />
</template>
