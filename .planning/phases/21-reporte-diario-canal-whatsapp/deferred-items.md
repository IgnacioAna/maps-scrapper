# Deferred items — Phase 21

Cosas encontradas durante la ejecución que quedan FUERA del alcance del plan que
las encontró (regla de scope boundary: solo se auto-arregla lo que causó el
propio cambio).

## 1. `tests/wa-campaign-engine.test.js` — 4 tests del describe "anti-ráfaga + routing"

- **Encontrado en:** 21-04, Task 3 (corrida de la suite completa antes de cerrar).
- **Síntoma:** los 4 tests del describe `anti-ráfaga + routing` fallan con
  `expected +0 to be 1` (el motor no emite ningún mensaje en el tick). Corridos
  en aislado fallan igual, con `retry x2`.
- **Por qué NO es del plan 21-04:** el archivo importa únicamente
  `src/wa/campaigns.js` y `src/wa/campaign-engine.js`; los commits de 21-04
  tocan **solo** `public/app.js` y `public/index.html` (verificado con
  `git diff --name-only`). No hay camino por el que este plan pueda influirlo.
- **Contexto:** es el flaky ambiental ya documentado en `CLAUDE.md` #93/#110/#113
  ("`wa-campaign-engine` depende de hora/día"). El módulo de campañas está
  **parkeado** desde el pivot a llamadas (nota #87), así que no bloquea nada
  operativo.
- **Sospecha para quien lo agarre:** los 4 tests del describe comparten la misma
  cuenta y el mismo `DATA_DIR` sin reset entre tests, y el cap diario por cuenta
  (`warmingCapByDay`) se cuenta por día — el primer test del bloque puede estar
  consumiendo el cap del resto según a qué hora corra la suite. Confirmarlo
  requiere entrar al motor de campañas, que está fuera del alcance de esta fase.
- **Acción:** ninguna acá. Si se reactiva el módulo WA, arreglar el fixture
  (reset de contadores por test) antes de tocar el motor.
