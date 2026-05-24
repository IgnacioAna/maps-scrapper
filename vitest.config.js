import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude orphan/parallel worktrees so we don't double-run tests from copies.
    // The main repo tests live in ./tests/. Other worktrees under .claude/worktrees/
    // and ~/.codex/worktrees/ have their own copies that should run in their own checkout.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/.claude/worktrees/**',
      '**/.codex/worktrees/**',
    ],
    // 2026-05-23: timeout default 5s era muy ajustado en Windows + supertest +
    // load setters/auth.json + mutex async. Tests con newGen() concurrentes
    // exigen mas. 20s deja margen sin permitir tests genuinamente colgados.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Retry x2 para tests flakys (Mercury en Windows ~1-2 timeouts por run de 408
    // tests, distinto test cada vez). Real bugs requieren 3 fails consecutivos.
    retry: 2,
  },
});
