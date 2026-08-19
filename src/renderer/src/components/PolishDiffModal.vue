<script setup lang="ts">
import { computed } from 'vue'
import { diffText, diffToHtml, hasDiff } from '../utils/textDiff'

export interface PolishDiffSection {
  label: string
  from: string
  to: string
}

const props = defineProps<{
  open: boolean
  title: string
  sections: PolishDiffSection[]
}>()

const emit = defineEmits<{
  accept: []
  reject: []
}>()

const views = computed(() =>
  props.sections.map((section) => ({
    label: section.label,
    changed: hasDiff(section.from, section.to),
    html: diffToHtml(diffText(section.from, section.to)),
  })),
)

const changedCount = computed(() => views.value.filter((v) => v.changed).length)
</script>

<template>
  <div v-if="open" class="score-modal-mask" @click.self="emit('reject')">
    <div class="score-modal polish-modal">
      <div class="score-modal-head">
        <h3>{{ title }}</h3>
        <div class="actions">
          <button class="btn light" type="button" @click="emit('reject')">不接受</button>
          <button class="btn" type="button" :disabled="!changedCount" @click="emit('accept')">
            接受润色
          </button>
        </div>
      </div>
      <p class="polish-hint">
        红色删除、绿色新增。确认后才写入编辑器。
        <template v-if="!changedCount">本次没有改动。</template>
      </p>
      <div class="polish-legend">
        <span class="diff-del">删除</span>
        <span class="diff-ins">新增</span>
        <span>未改动保持原样</span>
      </div>
      <section v-for="view in views" :key="view.label" class="polish-section">
        <div class="polish-section-head">
          <strong>{{ view.label }}</strong>
          <span class="status">{{ view.changed ? '有改动' : '无改动' }}</span>
        </div>
        <div class="polish-diff" v-html="view.html || '（空）'" />
      </section>
    </div>
  </div>
</template>
