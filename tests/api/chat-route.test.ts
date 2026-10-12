import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: {
    AI_MODEL: 'Qwen/Qwen2.5-7B-Instruct',
    AI_MAX_TOKENS: 2048,
    AI_TEMPERATURE: 0.3,
    AI_TOP_P: 0.8,
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase', async (importOriginal) => {
  // 用 importOriginal 保留真实模块的其它导出，仅覆盖 env 和 supabase
  // 避免 lib/supabase.ts 在模块加载时因缺少环境变量而 throw
  const actual = await importOriginal<typeof import('@/lib/supabase')>().catch(() => ({
    env: { AI_MAX_TOKENS: 1024 } as any,
    supabase: { from: vi.fn() } as any,
  }));
  return {
    ...actual,
    env: { AI_MAX_TOKENS: 1024, ...actual.env },
    supabase: {
      ...(actual.supabase ?? {}),
      from: vi.fn(),
    },
  };
});

import { auth } from '@clerk/nextjs/server';
import { rateLimit } from '@/lib/rate-limit';
import { ChatRequestSchema } from '@/lib/validation';
import { POST } from '@/app/api/chat/route';

describe('chat API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates a correct request payload', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！我可以帮你。' },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects unauthenticated requests', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as any);
    vi.mocked(rateLimit).mockReturnValue(true);

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(401);

    const json = await response.json();
    expect(json.error).toContain('请先登录');
  });

  it('rejects invalid payloads before hitting the model', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_123' } as any);
    vi.mocked(rateLimit).mockReturnValue(true);

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.error).toContain('请求参数校验失败');
  });
});
