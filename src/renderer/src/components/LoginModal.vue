<script setup lang="ts">
import { ref, watch } from 'vue'
import { loginByEmail, saveClientAuth, sendEmailCode } from '../api/auth'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const email = ref('')
const code = ref('')
const sending = ref(false)
const submitting = ref(false)
const error = ref('')
const wait = ref(0)
let timer: number | null = null

watch(
  () => store.loginOpen,
  (open) => {
    if (open) {
      error.value = ''
      code.value = ''
    }
  },
)

function close(): void {
  store.finishAiLogin(false)
}

async function sendCode(): Promise<void> {
  error.value = ''
  sending.value = true
  try {
    await sendEmailCode(email.value.trim())
    wait.value = 60
    if (timer) window.clearInterval(timer)
    timer = window.setInterval(() => {
      wait.value -= 1
      if (wait.value <= 0 && timer) {
        window.clearInterval(timer)
        timer = null
      }
    }, 1000)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '发送失败'
  } finally {
    sending.value = false
  }
}

async function submit(): Promise<void> {
  error.value = ''
  submitting.value = true
  try {
    const data = await loginByEmail(email.value.trim(), code.value.trim())
    saveClientAuth(data.token, data.email, data.name)
    store.finishAiLogin(true, data.email, data.name)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="store.loginOpen" class="score-modal-mask" @click.self="close">
    <div class="score-modal login-modal">
      <div class="score-modal-head">
        <h3>登录后使用 AI</h3>
        <button class="btn light" type="button" @click="close">关闭</button>
      </div>
      <p class="login-hint">笔记、论文、案例的编辑保存不需要登录。使用 AI 辅导 / 润色 / 讲解时请用邮箱验证码登录。</p>
      <div class="login-field">
        <label>邮箱</label>
        <input v-model="email" type="email" placeholder="name@example.com" autocomplete="email" @keyup.enter="sendCode">
      </div>
      <div class="login-field">
        <label>验证码</label>
        <div class="login-code-row">
          <input v-model="code" maxlength="6" placeholder="6 位验证码" autocomplete="one-time-code" @keyup.enter="submit">
          <button class="btn light" type="button" :disabled="sending || wait > 0" @click="sendCode">
            {{ wait > 0 ? `${wait}s` : sending ? '发送中…' : '获取验证码' }}
          </button>
        </div>
      </div>
      <p v-if="error" class="login-error">{{ error }}</p>
      <div class="login-actions">
        <button class="btn" type="button" :disabled="submitting" @click="submit">
          {{ submitting ? '登录中…' : '登录' }}
        </button>
      </div>
    </div>
  </div>
</template>
