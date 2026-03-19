/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.CI ? '/hunlef-simulator/' : '/',
  test: {
    include: ['src/**/*.test.ts'],
  },
});
