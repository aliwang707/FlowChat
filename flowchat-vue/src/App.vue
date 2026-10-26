<script setup lang="ts">
import { useChatStore } from './stores/chat'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { ref, watch } from 'vue'

const chat = useChatStore()
const { sessions, currentSession, loading } = storeToRefs(chat)
const route = useRoute()
const router = useRouter()
const input = ref('')

// 监听路由参数变化拉取数据
watch(
  () => route.params.id,
  (id) => {
    if (id) {
      chat.switchSession(Number(id))
      chat.loadMessages(Number(id))
    }
  },
  { immediate: true }
)

function send() {
  const id = Number(route.params.id)
  if (!input.value.trim() || !id) return
  chat.addMessage(id, input.value)
  input.value = ''
}
</script>

<template>
  <div class="app-container">
    <!-- 左侧侧边栏 -->
    <aside class="sidebar">
      <button class="new-btn" @click="router.push('/')">+ 新建会话</button>
      <div class="session-list">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="session-item"
          :class="{ active: route.params.id == String(s.id) }"
          @click="router.push(`/chat/${s.id}`)"
        >
          {{ s.title }}
        </div>
      </div>
    </aside>

    <!-- 右侧主区域 -->
    <main class="main-content">
      <header class="header">
        <h2>🤖 FlowChat</h2>
      </header>

      <div class="chat-area">
        <div v-if="!route.params.id" class="empty-state">
          <h1>你好，我是你的 AI 助手</h1>
          <p>请在左侧选择一个会话，或新建一个。</p>
        </div>

        <div v-else class="message-list">
          <p v-if="loading" class="loading">加载中...</p>
          <div
            v-for="m in currentSession?.messages ?? []"
            :key="m.id"
            class="message-bubble"
          >
            {{ m.text }}
          </div>
        </div>
      </div>

      <!-- 底部输入框 -->
      <footer v-if="route.params.id" class="input-area">
        <input v-model="input" placeholder="输入你的问题..." @keyup.enter="send" />
        <button @click="send">发送</button>
      </footer>
    </main>
  </div>
</template>

<style>
/* 这里直接全局重置样式，覆盖掉 Vite 默认的居中样式 */
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #f3f4f6; }

.app-container {
  display: flex;
  height: 100vh;
  width: 100vw;
}

/* 侧边栏样式 */
.sidebar {
  width: 260px;
  background-color: #fff;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  padding: 16px;
  flex-shrink: 0;
}

.new-btn {
  background-color: #2563eb;
  color: white;
  border: none;
  padding: 12px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: bold;
  margin-bottom: 16px;
}
.new-btn:hover { background-color: #1d4ed8; }

.session-list {
  flex: 1;
  overflow-y: auto;
}
.session-item {
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 6px;
  cursor: pointer;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-item:hover { background-color: #f3f4f6; }
.session-item.active { background-color: #eff6ff; color: #2563eb; font-weight: 500; }

/* 右侧主区域 */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
}

.header {
  height: 60px;
  background-color: #2563eb;
  color: white;
  display: flex;
  align-items: center;
  padding: 0 24px;
}

.chat-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
}

.empty-state {
  margin: auto;
  text-align: center;
  color: #6b7280;
}
.empty-state h1 { margin-bottom: 12px; color: #111827; }

.message-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.message-bubble {
  background-color: #f3f4f6;
  padding: 12px 16px;
  border-radius: 8px;
  align-self: flex-start;
  max-width: 80%;
  line-height: 1.5;
}

/* 底部输入区 */
.input-area {
  padding: 16px 24px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  gap: 12px;
}
.input-area input {
  flex: 1;
  padding: 12px 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  outline: none;
}
.input-area input:focus { border-color: #2563eb; }
.input-area button {
  background-color: #2563eb;
  color: white;
  border: none;
  padding: 0 24px;
  border-radius: 8px;
  cursor: pointer;
}
</style>