<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const name = ref('')
const saving = ref(false)
const error = ref('')

watch(
  () => store.profileOpen,
  (open) => {
    if (open) {
      name.value = store.clientName
      error.value = ''
    }
  },
)

function close(): void {
  store.closeProfile()
}

async function save(): Promise<void> {
  error.value = ''
  saving.value = true
  try {
    await store.saveProfileName(name.value.trim())
    close()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function logout(): Promise<void> {
  await store.logoutAi()
}
</script>

<template>
  <div v-if="store.profileOpen" class="score-modal-mask" @click.self="close">
    <div class="score-modal login-modal">
      <div class="score-modal-head">
        <h3>个人中心</h3>
        <button class="btn light" type="button" @click="close">关闭</button>
      </div>
      <div class="login-field">
        <label>邮箱</label>
        <input :value="store.clientEmail" type="email" disabled>
      </div>
      <div class="login-field">
        <label>昵称</label>
        <input
          v-model="name"
          maxlength="16"
          placeholder="最多 16 个字"
          @keyup.enter="save"
        >
      </div>
      <p v-if="error" class="login-error">{{ error }}</p>
      <div class="login-actions profile-actions">
        <button class="btn light" type="button" @click="logout">退出登录</button>
        <button class="btn" type="button" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存昵称' }}
        </button>
      </div>
    </div>
  </div>
</template>
