import { describe, it, expect } from 'vitest';
import { ChatRequestSchema, MessageSchema } from '@/lib/validation';

describe('ChatRequestSchema', () => {
  describe('✅ 合法输入', () => {
    it('应通过最小合法请求', () => {
      const result = ChatRequestSchema.safeParse({
        messages: [{ role: 'user', content: '你好' }],
      });
      expect(result.success).toBe(true);
    });

    it('应携带合法 UUID sessionId', () => {
      const result = ChatRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'hi' }],
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.success).toBe(true);
    });

    it('应接受恰好 20 条消息的边界', () => {
      const result = ChatRequestSchema.safeParse({
        messages: Array.from({ length: 20 }, () => ({
          role: 'user' as const,
          content: 'x',
        })),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('❌ 非法输入', () => {
    describe('messages 字段', () => {
      it('messages 不能为空数组', () => {
        const result = ChatRequestSchema.safeParse({ messages: [] });
        expect(result.success).toBe(false);
      });

      it('messages 不能超过 20 条（防上下文溢出）', () => {
        const manyMessages = Array.from({ length: 21 }, (_, i) => ({
          role: 'user',
          content: `消息 ${i}`,
        }));
        const result = ChatRequestSchema.safeParse({ messages: manyMessages });
        expect(result.success).toBe(false);
      });

      it('messages 缺失时应拒绝', () => {
        const result = ChatRequestSchema.safeParse({});
        expect(result.success).toBe(false);
      });

      it('messages 不是数组应拒绝', () => {
        const result = ChatRequestSchema.safeParse({ messages: 'not-array' });
        expect(result.success).toBe(false);
      });
    });

    describe('sessionId 字段', () => {
      it('非 UUID 格式应拒绝', () => {
        const result = ChatRequestSchema.safeParse({
          messages: [{ role: 'user', content: 'hi' }],
          sessionId: 'not-a-uuid',
        });
        expect(result.success).toBe(false);
      });

      it('空字符串 sessionId 应拒绝', () => {
        const result = ChatRequestSchema.safeParse({
          messages: [{ role: 'user', content: 'hi' }],
          sessionId: '',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('MessageSchema 内部字段', () => {
      it('role 不在枚举值应拒绝', () => {
        const result = MessageSchema.safeParse({
          role: 'tool',
          content: 'hi',
        });
        expect(result.success).toBe(false);
      });

      it('role 缺失应拒绝', () => {
        const result = MessageSchema.safeParse({ content: 'hi' });
        expect(result.success).toBe(false);
      });

      it('content 为空字符串应拒绝', () => {
        const result = MessageSchema.safeParse({
          role: 'user',
          content: '',
        });
        expect(result.success).toBe(false);
      });

      it('content 超过 10000 字符应拒绝', () => {
        const result = MessageSchema.safeParse({
          role: 'user',
          content: 'a'.repeat(10001),
        });
        expect(result.success).toBe(false);
      });

      it('content 缺失应拒绝', () => {
        const result = MessageSchema.safeParse({ role: 'user' });
        expect(result.success).toBe(false);
      });

      it('content 不是字符串应拒绝（数字）', () => {
        const result = MessageSchema.safeParse({
          role: 'user',
          content: 123,
        });
        expect(result.success).toBe(false);
      });

      it('存在额外字段应拒绝（strict 模式）', () => {
        const result = MessageSchema.safeParse({
          role: 'user',
          content: 'hi',
          extra: 'unexpected',
        });
        expect(result.success).toBe(false);
      });

      it('content 为 null 应拒绝', () => {
        const result = MessageSchema.safeParse({
          role: 'user',
          content: null,
        });
        expect(result.success).toBe(false);
      });
    });
  });
});