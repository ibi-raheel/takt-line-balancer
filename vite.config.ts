import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The demo is hosted under a sub-path of ibiraheel.com. Every asset and data fetch
// goes through import.meta.env.BASE_URL, so this is the only place the path lives.
export default defineConfig({
  base: '/demos/takt-line-balancer/',
  plugins: [react()],
});
