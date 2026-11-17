import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Ensure Vitest never connects to live Supabase via local .env files
export default defineConfig({
  plugins: [react()],
  test: {
    testTimeout: 15000,
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
});
