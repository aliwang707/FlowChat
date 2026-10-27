import { defineStore } from "pinia"
import { ref, computed } from "vue"
import axios from 'axios'

export interface Message {
    id: number
    text: string
}

export interface Session {
    id: number
    title: string
    messages: Message[]
}



export const useChatStore = defineStore('chat', () => {
    //state
    const sessions = ref<Session[]>([
        { id: 1, title: '会话一', messages: [] },
        { id: 2, title: '会话二', messages: [] },
        { id: 3, title: '会话三', messages: [] },
    ])
    const currentSessionId=ref<number>(1)
    const loading=ref(false)

    let nextMessageId=1
    let fetchToken=0 // 请求令牌，用于竞态控制

    //getter
    const currentSession=computed(()=>
        sessions.value.find((s)=>s.id===currentSessionId.value))

    //action
    function switchSession(id:number){
        currentSessionId.value=id
    }

    function addMessage(sessionId: number,text:string){
        const session=sessions.value.find((s)=>s.id===sessionId)
        if(!session||!text.trim()) return
        session.messages.push({id:nextMessageId++,text:text.trim()})
    }

  async function loadMessages(sessionId: number) {
    const token = ++fetchToken
    loading.value = true

    try {
      // 尝试请求本地真实后端
      const res = await axios.get(`http://localhost:8080/api/chat/history?sessionId=${sessionId}`, {
        timeout: 2000 // 加个超时，连不上就立刻走 catch
      })
      
      if (token !== fetchToken) return

      const session = sessions.value.find((s) => s.id === sessionId)
      if (session) {
        session.messages = res.data.data.map((item: any) => ({
          id: item.id,
          text: item.content
        }))
      }
    } catch (error) {
      // 线上环境（或连不上后端时）的降级兜底方案
      console.warn("未能连接到本地 Java 后端，启用前端 Mock 数据展示")
      
      if (token !== fetchToken) return
      
      const session = sessions.value.find((s) => s.id === sessionId)
      if (session) {
        session.messages = [
          { id: 1, text: "这是前端展示数据（线上Demo未连接本地 Java 后端）" },
          { id: 2, text: `你好！欢迎体验 Vue 3 + Pinia 重构版。当前会话 ID：${sessionId}` }
        ]
      }
    } finally {
      if (token === fetchToken) {
        loading.value = false
      }
    }
  }

    return{
        sessions,currentSessionId,currentSession,loading,switchSession,addMessage,loadMessages
    }

})