import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/inworld-api': {
          target: 'https://api.inworld.ai',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/inworld-api/, ''),
        },
      },
    },
    plugins: [react()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.PINECONE_API_KEY': JSON.stringify(env.VITE_PINECONE_API_KEY),
      'process.env.PINECONE_HOST': JSON.stringify(env.VITE_PINECONE_HOST)
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') }
    }
  };
});
