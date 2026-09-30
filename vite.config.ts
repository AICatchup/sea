import { defineConfig } from 'vite';

// Worktrees can share dependency binaries, but each preview owns its optimizer
// cache. A shared node_modules/.vite cache invalidates the other server's URLs.
export default defineConfig({ base: './', cacheDir:'.vite', assetsInclude:['**/*.hdr','**/*.exr','**/*.glb','**/*.bin'] });
