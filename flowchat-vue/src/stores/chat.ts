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

// 模拟后端接口：根据 sessionId 返回该会话的消息，延迟随机 100~800ms
function mockFetchMessages(sessionId:number):Promise<Message[]>{
    return new Promise((resolve)=>{
        const delay=100+Math.random()*700
        setTimeout(()=>{
            resolve([
                {id:sessionId*100+1,text:`服务端：会话 ${sessionId} 的消息 1`},{ id: sessionId * 100 + 2, text: `服务端：会话 ${sessionId} 的消息 2` },
            ])
        },delay)
    })
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

async function loadMessages(sessionId:number) {
    const token=++fetchToken
    loading.value=true
    
    try{
        // 请求真实的数据库接口
      const res = await axios.get(`http://localhost:8080/api/chat/history?sessionId=${sessionId}`)

    // 竞态校验：如果响应回来时已有更新的请求，丢弃本次结果
    if(token!==fetchToken) return

    const session=sessions.value.find((s)=>s.id===sessionId)
    if(session){
        session.messages=res.data.data.map((item:any)=>({id:item.id,text:item.content}))
    }
    
    }catch(error){
        console.error("请求失败", error)
    }finally{
        if(token===fetchToken){
            loading.value=false
        }
    }

    

    
    
}

    return{
        sessions,currentSessionId,currentSession,loading,switchSession,addMessage,loadMessages
    }

})