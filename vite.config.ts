/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/hunlef-simulator/',
  test: {
    include: ['src/**/*.test.ts'],
  },
});
