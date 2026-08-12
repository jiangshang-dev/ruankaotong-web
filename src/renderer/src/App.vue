<script setup lang="ts">
import { onMounted } from 'vue'
import { useAppStore } from './stores/app'

const store = useAppStore()

onMounted(() => {
  store.bootstrap()
})
</script>

<template>
  <div v-if="!store.ready" class="welcome">
    <div class="welcome-card">
      <h2>软考通</h2>
      <p>正在加载本地配置…</p>
    </div>
  </div>
  <router-view v-else />
</template>
