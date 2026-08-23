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
    // 2026-08-23 (Fase 38, EDGE-03): 20000 quedaba corto bajo presión de
    // máquina en `beforeAll` (levantar el fixture completo del server +
    // datos). Corrida de las 14:45: 3 archivos (entre ellos
    // tests/retell-lead-timezone.test.js) murieron con "Hook timed out in
    // 20000ms" en beforeAll, sin una sola aserción fallida — 222s totales,
    // 1177s de import acumulado contra 730s de una corrida limpia. Corrida
    // de las 15:17 (misma máquina, sin cambios de código): 124/124 archivos,
    // 2274/2274 tests, 0 fallos en 138s. No es un bug real: subido a 30000
    // para dar margen a hooks de import lentos sin tapar timeouts genuinos
    // (30s sigue siendo corto para un test realmente colgado).
    hookTimeout: 30000,
    // Retry x2 para tests flakys (Mercury en Windows ~1-2 timeouts por run de 408
    // tests, distinto test cada vez). Real bugs requieren 3 fails consecutivos.
    retry: 2,
  },
});
