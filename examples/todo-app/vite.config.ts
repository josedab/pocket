import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['@pocket/core', '@pocket/react', '@pocket/storage-indexeddb'],
  },
});
