/**
 * 该 hook 负责网络层的流式读取与消息追加逻辑，与 UI 解耦。
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import throttle from 'lodash/throttle';

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sessionId?: string;
  isLoading?: boolean;
  error?: boolean;
};

export type ChatStatus = 'idle' | 'loading' | 'canceled' | 'error';

// ========== Hook 主函数 ==========
export function useChatStream(
  currentSessionId: string | null,
  onSessionCreated: (id: string) => void,
  onRefreshSessions: () => void
) {
  // ---------- 1. State：会被渲染用到的响应式数据 ----------
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // ---------- 2. Ref：跨越闭包、不需要触发渲染的数据 ----------
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentAiIdRef = useRef<string | null>(null);
  const isFinishRef = useRef(false); // 防止重复结束
  const manualCancelRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenBufferRef = useRef('');
  const throttledFlushRef = useRef<ReturnType<typeof throttle> | null>(null);
  const hasReceivedFirstTokenRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  
  // ---------- 3. useEffect：副作用 ----------
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const scrollToBottom = useCallback(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
}, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // 节流
  useEffect(() => {
    throttledFlushRef.current = throttle(() => {
      if (!tokenBufferRef.current) return;
      const tokens = tokenBufferRef.current;
      tokenBufferRef.current = '';
      setMessages(prev =>
        prev.map(m =>
          m.id === currentAiIdRef.current ? { ...m, content: m.content + tokens } : m
        )
      );
      requestAnimationFrame(scrollToBottom);
    }, 10);

    return () => throttledFlushRef.current?.cancel();
  }, [scrollToBottom]);

  const clearTimeoutRef = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // 统一结束函数：无论正常、取消、超时都调用
  // 用 useCallback 包裹，避免被 resetChat 等外层 Hook 锁死旧引用
  const finishAiReply = useCallback(
    (extraText?: string) => {
      if (isFinishRef.current) return;
      const id = currentAiIdRef.current;
      if (id) {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === id
              ? {
                  ...msg,
                  content: msg.content + (extraText ? `\n\n${extraText}` : ''),
                  isLoading: false,
                }
              : msg
          )
        );
        currentAiIdRef.current = null;
        isFinishRef.current = true;
        onRefreshSessions();
        setIsStreaming(false);
      }
    },
    [onRefreshSessions]
  );

  // 清洗消息
  const cleanMessages = (raw: Message[]) => {
    return raw
      .slice(-20)
      .filter(m => !m.isLoading && m.content.trim().length > 0)
      .map(m => ({ role: m.role, content: m.content }));
  };

  // ========== 4. 发送消息主流程 ==========
  const handleSubmit = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || loading) return;

      // 重置标志
      manualCancelRef.current = false;
      isFinishRef.current = false;
      hasReceivedFirstTokenRef.current = false;
      setIsStreaming(false);
      tokenBufferRef.current = '';
      throttledFlushRef.current?.cancel();
      setError(null);
      setStatus('loading');
      setLoading(true);

      // 构造用户消息
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        sessionId: currentSessionId || undefined,
      };
      const nextMessages = [...messagesRef.current, userMsg];
      setMessages(nextMessages);
      setInput('');
      onRefreshSessions();

      const cleaned = cleanMessages(nextMessages);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // 超时定时器
      timeoutRef.current = setTimeout(() => {
        if (controller.signal.aborted) return;
        if (!manualCancelRef.current) {
          controller.abort();
          finishAiReply('[生成超时]');
          setStatus('error');
          setError('请求超时，请稍后重试');
        }
      }, 120000);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            messages: cleaned,
            sessionId: currentSessionId || undefined,
          }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`请求失败：${res.status}`);
        if (!res.body) throw new Error('无法获取响应流');

        // 创建 AI 消息占位
        const aiId = `ai-${Date.now()}`;
        currentAiIdRef.current = aiId;
        setMessages(prev => [
          ...prev,
          {
            id: aiId,
            role: 'assistant',
            content: '',
            sessionId: currentSessionId || undefined,
            isLoading: true,
          },
        ]);
        onRefreshSessions();
        requestAnimationFrame(scrollToBottom);

        const reader = res.body
          .pipeThrough(new TextDecoderStream('utf-8'))
          .getReader();

        let receivedSessionId = currentSessionId;
        let totalChars = 0;
        let lastToken = '';
        let repeatCount = 0;
        const MAX_CHARS = 15000;
        const MAX_REPEAT = 10;
        let lineBuffer = ''; // 跨 chunk 拼接 SSE 行，防止行在 TCP 边界被截断

        const processLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) return;
          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === '[DONE]') return;

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.error) {
              throw new Error(parsed.error.message || 'AI 服务返回错误');
            }
            const token = parsed.token;
            if (!token) return;

            totalChars += token.length;
            if (token === lastToken) {
              repeatCount++;
            } else {
              repeatCount = 0;
              lastToken = token;
            }
            // 不再用 AbortError，改用自定义标识，避免误判为超时
            if (totalChars > MAX_CHARS || repeatCount > MAX_REPEAT) {
              controller.abort();
              throw new Error('AI_REPLY_TOO_LONG');
            }

            // 第一个 token 立即更新
            if (!hasReceivedFirstTokenRef.current) {
              hasReceivedFirstTokenRef.current = true;
              setIsStreaming(true);
              setMessages(prev =>
                prev.map(m =>
                  m.id === currentAiIdRef.current
                    ? { ...m, content: m.content + token }
                    : m
                )
              );
              tokenBufferRef.current = '';
              return;
            }

            tokenBufferRef.current += token;
            throttledFlushRef.current?.();

            if (parsed.sessionId && !receivedSessionId) {
              receivedSessionId = parsed.sessionId;
              onSessionCreated(parsed.sessionId);
              onRefreshSessions();
            }
          } catch (e) {
            // 只把 AbortError 和超长标识向外抛，其他 JSON 解析错误静默忽略
            if (
              e instanceof Error &&
              (e.message === 'AbortError' || e.message === 'AI_REPLY_TOO_LONG')
            ) {
              throw e;
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuffer += value;
          const lines = lineBuffer.split('\n');
          // 最后一段可能是不完整行（没有以 \n 结尾），留在 buffer 里下次拼接
          lineBuffer = lines.pop() ?? '';
          for (const line of lines) {
            processLine(line);
          }
        }

        // 流结束时，若残留一行未以 \n 结尾，也尝试处理一次
        if (lineBuffer.trim()) {
          processLine(lineBuffer);
          lineBuffer = '';
        }

        // 正常结束流
        throttledFlushRef.current?.flush();
        finishAiReply();
        clearTimeoutRef();
        setStatus('idle');
      } catch (err: any) {
        throttledFlushRef.current?.flush();
        clearTimeoutRef();
        setIsStreaming(false);

        if (manualCancelRef.current) {
          // 用户主动取消：已在 handleCancel 中处理，这里只重置状态
          setStatus('canceled');
        } else if (err.message === 'AI_REPLY_TOO_LONG') {
          // ai输出超长
          finishAiReply('[回复过长，已自动中断]');
          setStatus('error');
          setError('回复内容过长，已自动中止');
        } else if (err.name === 'AbortError' || err.message === 'AbortError') {
          // 被动中止：一定是超时（因为用户主动取消已在上面分支处理）
          finishAiReply('[生成超时]');
          setStatus('error');
          setError('请求超时，请稍后重试');
        } else {
          // 其他错误
          setStatus('error');
          setError(err.message || '发送失败');
          onRefreshSessions();
        }
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
        clearTimeoutRef();
        setIsStreaming(false);
      }
    },
    // 依赖项：所有会被闭包捕获的外部变量
    [input, loading, currentSessionId, onSessionCreated, onRefreshSessions, finishAiReply, scrollToBottom]
  );

  // ---------- 5. 用户主动取消 ----------
  const handleCancel = useCallback(() => {
    if (!abortControllerRef.current) return;

    manualCancelRef.current = true;
    throttledFlushRef.current?.flush();
    setIsStreaming(false);

    const id = currentAiIdRef.current;
    if (id) {
      const targetMsg = messagesRef.current.find(m => m.id === id);
      if (targetMsg && targetMsg.content.length < 10) {
        setMessages(prev => prev.filter(m => m.id !== id));
      } else {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === id
              ? { ...msg, content: msg.content + '\n\n[已取消生成]', isLoading: false }
              : msg
          )
        );
      }
      currentAiIdRef.current = null;
      isFinishRef.current = true;
    } else {
      setMessages(prev => [
        ...prev,
        { id: `cancel-${Date.now()}`, role: 'system', content: '已取消生成', error: false },
      ]);
    }

    abortControllerRef.current.abort();
    abortControllerRef.current = null;
    clearTimeoutRef();
    setLoading(false);
    setStatus('canceled');
    onRefreshSessions();
    scrollToBottom();
  }, [scrollToBottom, onRefreshSessions]);

  // ========== 6. 按 ESC 键取消 ==========
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && loading) handleCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, handleCancel]);

  // ========== 7. 重置聊天状态（切换会话 / 新建会话时调用） ==========
  const resetChat = useCallback(() => {
    setStatus('idle');
    setError(null);
    setLoading(false);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    clearTimeoutRef();
    throttledFlushRef.current?.flush();
    finishAiReply(); // 安全结束
  }, [finishAiReply]);

  // ========== 8. 对外暴露的 API ==========
  return {
    input,
    setInput,
    messages,
    setMessages,
    loading,
    isStreaming,
    status,
    error,
    handleSubmit,
    handleCancel,
    resetChat,
    messagesEndRef,
  };
}