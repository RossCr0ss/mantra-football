// Vitest config for the simulation harness only (the app's own config is apps/web/vitest.config.ts).
// SRC = the apps/web/src directory of the engine under test, so two versions can be compared (see ../README.md).
import path from 'node:path';

export default {
  root: path.resolve(import.meta.dirname),
  resolve: { alias: { '@': path.resolve(process.env.SRC) } },
  test: { include: ['run.test.ts'], globals: true, environment: 'node', testTimeout: 1800000 },
};
