import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    hookTimeout: 120_000, // the first start of the test database can be slow
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-only-secret-0123456789abcdef0123456789abcdef',
      GEMINI_API_KEY: 'test-key-not-real',
      GEMINI_MODEL: 'test-chat-model',
      GEMINI_EMBED_MODEL: 'test-embed-model',
    },
  },
});