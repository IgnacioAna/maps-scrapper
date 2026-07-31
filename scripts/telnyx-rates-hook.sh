#!/bin/sh
# Hook SessionStart — importa la rate sheet nueva de Telnyx cuando entre en vigencia.
#
# Contexto (2026-07-31): Telnyx avisó por mail que las tarifas de voz global
# cambian el 2026-08-06 10:00 UTC. El sistema lee data/telnyx_rates.json desde
# process.cwd() (NO desde el volumen de Railway), así que la hoja que vale en
# producción es la commiteada — importar es sólo el primer paso de tres:
# importar → commitear → pushear a main.
#
# Antes del 6/8 este script no hace nada. Después, si la hoja todavía es la
# vieja, importa la nueva y avisa que falta commitear + pushear.
# Se auto-desactiva solo: una vez importada, `source` coincide y sale en silencio.
#
# Para desarmarlo antes de tiempo: sacar el bloque SessionStart de
# .claude/settings.local.json (o borrar este archivo).

set -u

EFFECTIVE=20260806
EXPECTED_CSV="global_conver_c7a65d2347.csv"
RATES_JSON="data/telnyx_rates.json"

TODAY=$(date +%Y%m%d)

# 1. Todavía no entró en vigencia -> nada que hacer.
[ "$TODAY" -lt "$EFFECTIVE" ] && exit 0

# 2. ¿Estamos en el repo correcto? (el hook corre con cwd = raíz del proyecto)
[ -f "scripts/import-telnyx-rates.mjs" ] || exit 0

# 3. ¿Ya se importó? El campo `source` del JSON guarda el nombre del CSV origen.
CURRENT=$(node -e "try{process.stdout.write(String(require('./$RATES_JSON').source||''))}catch(e){}" 2>/dev/null)
[ "$CURRENT" = "$EXPECTED_CSV" ] && exit 0

# 4. Buscar el CSV en las ubicaciones probables.
CSV=""
for p in \
  "$HOME/OneDrive/Desktop/$EXPECTED_CSV" \
  "$HOME/Desktop/$EXPECTED_CSV" \
  "./$EXPECTED_CSV"
do
  if [ -f "$p" ]; then CSV="$p"; break; fi
done

emit() {
  # $1 = systemMessage (para el user), $2 = additionalContext (para Claude)
  MSG="$1" CTX="$2" node -e '
    process.stdout.write(JSON.stringify({
      systemMessage: process.env.MSG,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: process.env.CTX
      }
    }));
  '
}

# 5a. El CSV no está -> recordar, no fallar.
if [ -z "$CSV" ]; then
  emit \
"Tarifas Telnyx: las nuevas rigen desde el 06/08/2026 y la hoja del repo sigue siendo la vieja ($CURRENT). No encontre el CSV $EXPECTED_CSV en el Desktop." \
"El hook de tarifas Telnyx detecto que data/telnyx_rates.json esta desactualizado (source actual: '$CURRENT', esperado: '$EXPECTED_CSV') pero no encontro el CSV. Pedile al usuario que lo baje de nuevo desde portal.telnyx.com (seccion Pricing, 'Voz global conversacional') y despues correr: node scripts/import-telnyx-rates.mjs <ruta-al-csv>, commitear data/telnyx_rates.json y pushear a main (Railway lee la hoja del repo, no del volumen)."
  exit 0
fi

# 5b. Importar.
OUT=$(node scripts/import-telnyx-rates.mjs "$CSV" 2>&1)
STATUS=$?

if [ $STATUS -ne 0 ]; then
  emit \
"Tarifas Telnyx: el import automatico fallo. Hay que correrlo a mano." \
"El hook intento importar la rate sheet nueva de Telnyx desde '$CSV' y fallo (exit $STATUS). Salida: $OUT. Revisar el CSV y correr a mano: node scripts/import-telnyx-rates.mjs \"$CSV\""
  exit 0
fi

emit \
"Tarifas Telnyx actualizadas: se importo la hoja vigente desde el 06/08/2026. FALTA commitear data/telnyx_rates.json y pushear a main para que produccion la use." \
"El hook de tarifas importo automaticamente la rate sheet nueva de Telnyx (vigencia 2026-08-06) desde '$CSV' a data/telnyx_rates.json. Salida del import: $OUT. IMPORTANTE: produccion lee esta hoja desde el repo (process.cwd()/data), no desde el volumen de Railway, asi que el cambio NO esta vivo hasta commitear data/telnyx_rates.json y pushear a main. Avisale al usuario y ofrecele hacerlo. Contexto de lo que cambia: casi todas las tarifas se movieron 0.0001 (redondeo); el unico cambio real es Uruguay fijo, que baja de 0.1218 a 0.0625. Mexico (mercado del piloto del agente de voz) queda igual: 0.0071 fijo / 0.0291 movil. Espana fijo sigue en 0.4001, o sea que los destinos de tarifa roja de _expensiveTariffLabel siguen bloqueados con razon."
exit 0
