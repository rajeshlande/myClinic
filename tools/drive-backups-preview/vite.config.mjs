import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),plugins:[react()],server:{host:'0.0.0.0',allowedHosts:true,fs:{allow:[fileURLToPath(new URL('../..',import.meta.url))]}},build:{outDir:fileURLToPath(new URL('../../.arena/drive-backups-preview',import.meta.url)),emptyOutDir:true}});
