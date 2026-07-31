# MILESTONE-CONTEXT — Agente de voz (Retell AI)

> Generado 2026-08-01 desde la sesión de discusión con el user (equivalente a
> /gsd-discuss-milestone). Consumir en /gsd-new-milestone y borrar.

## Qué se quiere construir

Un agente de voz IA que llame en frío a clínicas dentales, pase la recepción,
hable con el decisor e **intente agendar la reunión directamente**. Si no
agenda, captura datos (nombre del doctor, recepcionista, objeción, cuándo
rellamar) y deja una nota de seguimiento. Los interesados los cierra el user
(Ignacio) por teléfono/WhatsApp. El agente alimenta el MISMO circuito que una
SDR humana: callLog → cascada de outcome → cadencia → funnel → biblioteca.

## Plataforma elegida (investigación hecha, decisión tomada)

**Retell AI**, pay-as-you-go, con **BYO SIP trunk de Telnyx** (conserva números
propios, caller ID, filtro de tarifas, DNC, reconciliación de costos por CDR).
Cuenta ya creada (workspace "SCM", trial $10, concurrencia 20, Telnyx CPS
nativo). Descartados: Bland (telefonía propia obligada), Vapi (sin camino a
clientes), Synthflow ($1400/mes), GHL Voice AI (más caro, encerrado), open
source (no justifica a este volumen). GHL queda como capa de entrega a
clientes futuros — integración NO incluida en este milestone.

## Decisiones del user (cerradas)

1. El agente NO se identifica como IA; ante "¿sos un robot?" esquiva con humor.
2. Persona: nombre propio del equipo (ej. "Sofía, del equipo de Ignacio en SCM
   Dental"); agenda "reunión con Ignacio, el director". Nombre final se elige
   junto con la voz.
3. Si atiende el doctor directo → pitch completo e intento de agendar ahí.
4. Sin transferencia a humano en vivo. Sin voicemail. Sin pedir WhatsApp
   (pide cuándo rellamar / número del doctor; captura nombres).
5. Lotes manuales: el user elige cantidad/país/filtro (con o sin nombre de
   doctor) y dispara. Nada automático. Piloto: México, pool sin asignar.
6. Pseudo-SDR `setter_agente_ia`: métricas comparables lado a lado con las
   SDRs humanas en Equipo/Comando/Mi rendimiento. Cero vistas de métricas nuevas.
7. Presupuesto piloto ~$50. Primera llamada de prueba al propio user.
8. Sección "Agente de voz" propia en el panel (config + lote + resultados).
9. Guiones PACE/v2 del user = materia prima de los nodos (no script literal).
10. Actualizar el banco de conocimiento del sistema con el material unificado
    (solo OpenAI — Mercury/Qwen ya no existen; verificar en código).

## Research consumido (skip research en new-milestone: ya está hecho)

- **Curso Retell 4h (Conversational Flow)**: modo Rigid, transiciones por
  ecuación, Function nodes deterministas (timeout 5s), Post Call Data
  Extraction, `user_number` gotcha, costo $0.115-0.12/min, latencia real
  970-1300ms, testing por API solo chat.
- **Docs Retell**: `POST /v2/create-phone-call` (from_number registrado,
  retell_llm_dynamic_variables), webhook `x-retell-signature` (verify del SDK,
  key con webhook badge), custom telephony vía elastic SIP trunk con
  credenciales (Telnyx primera clase).
- **5 docs del user**: Entrenamiento Cold Calling v2 (9 scripts por escenario
  → nodos), openers canónicos, Script v3 de cierre (oferta, reglas: sin
  precios, sin stack), RSN template, Voss/Blount.
- **4 cursos de cold calling** (Glencoco, 30MPC+datos Gong, Sell Better,
  Higher Levels/Connor, NEPQ/Miner) + playbook consolidado del user:
  problem proposition (16% vs 5,5%), tie-down 4 pasos, secuencia de objeciones
  fusionada (1ª doblar / 2ª Miyagi+opción múltiple / 3ª salida a 3 meses →
  callback +90d), branch "no hay dolor", tonalidad (lento, descendente),
  agenda de la invitación (qué va a aprender), higiene de números/spam.
- **Exploración del código** (agente, con líneas): call-disposition
  index.js:10301 (sync, cascada 10552-10675, `MAX_NO_CONTACT=2`),
  calendarEntry shape 10607 (`sourceCall:true`), sin-wsp 8161 +
  `_leadIsCallableNow` 9175 + `_tariffBlocked` 9172, callLog fields, transcript
  shape + `_autoDispositionLLM` 16232 + `_trainingSummaryLLM` 16171 (reusables
  con `{speaker,text,start,end}`), webhook Telnyx 15551 + rawBody 108-118 +
  fail-closed, patrón `TELNYX_ENV_FIELDS` 14070, `pickNumberForDestination` en
  frontend app.js:2270 (hay que portarlo), `mutateSettersData` 6702,
  atribución `by`/`_callSetterId` (nota #149: `by:''` → assignedTo).

## Mapa de nodos del agente (borrador para Phase de prompt/flow)

detect → gk_con_nombre (eq: doctor_name exists) / gk_sin_nombre (referidor +
ruta C enganche recepcionista) → opener_doctor (permiso directo, interrupción
OFF) → pitch (problem proposition con {{reviews}}/{{years}}, variante corta)
→ agendar (Function node /book, tie-down 4 pasos, dos días/dos horarios) →
objeciones (contador: 1ª doblar / 2ª Miyagi / 3ª salida 3 meses) →
interes_sin_agenda (extract callback/quien_decide/objecion) → ending.
Post Call Data Extraction: atendio, doctor_name, recepcionista_nombre,
interes, objecion_principal, callback_fecha_hora, email, agendo,
nota_seguimiento.
Reglas globales: sin precios, sin stack técnico, diferir detalle a la reunión,
silencio tras cierre, preguntas negativas ("¿estaría en contra de…?"),
prohibidos "¿cómo va tu día?"/"¿te agarré en mal momento?", DNC → aceptar.

## Arquitectura de integración

```
SCM dispatch (admin) ──create-phone-call──▶ Retell (agent + variables del lead)
                                              │ SIP trunk ── Telnyx (números propios)
Retell tool /book ◀── si consigue turno ──────┤
Retell webhook  ◀── call_analyzed ────────────┘
   │ transcript + duración + extraction
   ▼
callLog (channel:'retell', by:'') → _applyCallOutcome (refactor de la cascada
existente) → cadencia/DNC/calendar → funnel/Comando/Equipo/biblioteca
```

Piezas backend: `retell_config.json` (patrón env>JSON de Telnyx, regla #21 de
backups), refactor `_applyCallOutcome` (paridad garantizada por
metrics-consistency), dispatch por lote (respeta `_leadIsCallableNow` +
dailyCap), tool `/book` (header secreto; calendarEntry `sourceCall:true`),
webhook firmado fail-closed, pseudo-SDR. Frontend: sección "Agente de voz".

## Restricciones

- Rama: `claude/voice-agent-system-t02slh`. Railway escucha `main`;
  `npm run pre-deploy` antes de push a main (lo corre el user).
- Toda métrica DERIVA del CALL METRICS CORE. Suite completa verde por phase.
- Cache-buster ante cambios frontend. Rutas sin `:id` antes de rutas con `:id`.
- Pasos que requieren al user (dashboard Retell, trunk, voz, gasto, llamada de
  prueba): `autonomous: false`.
- `_stripBrandMentions` (regla #119) NO aplica al prompt del agente (vive en
  Retell); documentar para que nadie lo "arregle".

## Preguntas abiertas (se resuelven en ejecución, no bloquean planning)

- Formato exacto de verificación del webhook Retell (SDK verify vs HMAC crudo)
  → confirmar contra docs/SDK al implementar.
- Reconciliación CDR: ¿el matcher exige `channel:'telnyx_webrtc'`? → verificar
  y aflojar si hace falta.
- Facturación de ring vs conectado en Retell → preguntar antes del piloto.
- Voz en español: elegir entre 3 candidatas con el trial (con el user).
