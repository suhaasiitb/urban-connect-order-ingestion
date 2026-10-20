import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Supports GitHub Pages base path via VITE_BASE_PATH (defaults to './' for relative asset resolution)
  base: process.env.VITE_BASE_PATH || './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
});
