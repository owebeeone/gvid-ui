/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'app',
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', '@owebeeone/grip-core', '@owebeeone/grip-react'],
  },
  server: {
    fs: { allow: ['..', '../../gryth-wz', '../../glade-wz'] },
  },
  build: { outDir: '../dist', emptyOutDir: true },
  test: {
    root: '.',
    include: ['packages/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}'],
  },
});
