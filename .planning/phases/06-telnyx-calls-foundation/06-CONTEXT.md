# Phase 6 — Telnyx Calls Foundation — CONTEXT

> Captura de contexto pre-planning. Decisiones tomadas en sesión 2026-05-21.

---

## Goal

Habilitar a setters y admin a llamar internacional desde el browser
(WebRTC) usando números virtuales de Telnyx con caller ID local según el
país destino. Cierra el loop de "leads sin WSP" que hoy quedan en limbo
porque los setters no usan sus celulares personales para llamar al
extranjero.

Esta phase es la **base de infraestructura**. No es Phase 5 (Llamadas IA
con voz automatizada) — esa queda diferida y depende de esta.

---

## Decisiones arquitectónicas

### 1. Proveedor: Telnyx (no CloudTalk, no Twilio)

**Comparativa evaluada:**

| Opción | Costo mensual estimado (1 usuario) | Pros | Contras |
|---|---:|---|---|
| CloudTalk | $90-140 | UI lista, grabación, transcripción, dashboard, soporte humano | Caro, escala mal con setters, dependencia externa |
| Twilio | $30-80 | Más conocido, ecosistema | Tarifas algo más caras por minuto que Telnyx |
| **Telnyx** | **$35-55** | Pay-as-you-go, tarifas más baratas, SDK WebRTC bueno, API limpia | UI hay que construirla (oportunidad) |

**Decisión: Telnyx + UI custom dentro del SCM.** Razones:
- Costo target alcanzado ($35-55/mes vs $90-140 de CloudTalk = 3× más barato)
- Control total sobre UX (integrado con el callLog/disposition existentes)
- Escala mejor (sumar setters no escala el costo fijo de planes)
- Lock-in mínimo: si Telnyx falla, migrar a Twilio es trivial (arquitectura genérica)

### 2. Caller ID por país destino

**Insight clave**: una llamada desde número argentino (+54) a dentista
español tiene tasa de atención bajísima — el dentista ve número
extranjero y no atiende.

**Solución**: comprar números virtuales en los países destino frecuentes
(España, México, Colombia, EEUU). El sistema elige automáticamente cuál
usar como "from" según el país del lead.

Costo de números: ~$1-2/mes c/u. Total ~$5/mes en 4 números.

### 3. WebRTC en browser (no app desktop)

Telnyx ofrece SDK `@telnyx/webrtc` que corre en cualquier browser moderno.
El setter NO instala nada — abre Chrome (o Biscuit), entra al SCM, click
"Llamar", habla por el mic de su computadora.

Ventajas vs app desktop:
- Cero distribución
- Setters ya tienen browser abierto trabajando
- Update inmediato (es web)
- Cross-platform (Win/Mac/Linux)

### 4. Reuso de callLog/disposition existente

El módulo `view-calls` ya tiene:
- `lead.callLog[]` array con outcomes
- `lead.callAttempts` contador
- `lead.callbackAt` para callbacks programados
- `lead.phoneStatus` (wrong/invalid/voicemail)
- Endpoint `POST /api/setters/leads/:id/call-disposition`

**Esta phase NO toca eso.** Solo agrega la capa de "iniciar llamada
desde browser". Al colgar, el sistema dispara el modal de disposition
que ya existe.

---

## Scope

### IN scope (entregable en 2 días)

1. **Backend foundation**
   - Storage de config Telnyx (API key, números comprados con país, asignación a setters)
   - Endpoints: GET/POST/PATCH/DELETE numbers, GET config
   - Webhook receiver de Telnyx para eventos de llamada (call.initiated, call.answered, call.hangup)

2. **Frontend dialer**
   - Botón "📞 Llamar" en cada fila de view-calls
   - Panel de llamada activa (modal flotante): timer, mute, colgar, info del lead
   - Integración WebRTC con `@telnyx/webrtc` SDK
   - Detección de país destino → routing de caller ID

3. **Disposition integration**
   - Al colgar, prompt automático con outcomes existentes
   - Notas inline durante la llamada
   - Costo estimado por llamada (minutos × tarifa por país)

4. **Métricas**
   - Stats: minutos consumidos hoy/mes, costo USD acumulado
   - Por setter, por país

5. **Script panel inline**
   - Panel lateral durante la llamada
   - Value Statement Framework adaptado a dental (apertura, manejo de
     objeción "ya tengo sistema", doble apuesta sobre la reunión)
   - Editable desde admin

### OUT of scope (queda para futuras phases)

- Grabación con storage en S3/disco local
- Transcripción Whisper post-llamada
- Mercury IA en vivo durante la llamada (sugerencias contextuales)
- Coaching dashboard avanzado (% objeciones manejadas, duración promedio, etc.)
- Dialer predictivo / automation
- SMS bidireccional via Telnyx
- Integración con el módulo Multi-Account WhatsApp (no relacionado)

---

## Constraints

- **16 horas reales de desarrollo total**
- **Distribuido en 2 días** (deadline duro: plan Claude del usuario se acaba)
- **Costo operativo target: ~$35-55 USD/mes** (vs $90-140 de CloudTalk)
- **Cero dependencias nuevas pesadas**: solo agregar `@telnyx/webrtc` al frontend
- **No romper lo existente**: view-calls debe seguir funcionando con su
  modo manual (callLog) si Telnyx no está configurado

---

## Success criteria

1. Admin configura API key Telnyx + lista de números comprados con país
2. Botón "📞 Llamar" en cada lead de view-calls inicia llamada WebRTC
3. Panel de llamada activa muestra timer, botón mute, botón colgar
4. Caller ID saliente se elige automáticamente según país destino del lead
5. Al colgar, prompt de disposition se abre (reusa endpoint existente)
6. Stats reales: minutos consumidos hoy/mes, costo USD por setter y país
7. Script panel inline con value statement framework adaptado a dental

---

## Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| KYC de Telnyx demora 24-48 hs y bloquea el sprint | Empezar con WebRTC en modo testing/sandbox que no requiere KYC, llamadas reales el día 2 |
| WebRTC requiere permisos de mic del browser | Banner explicativo + retry de permission request en panel de llamada |
| Costos exceden lo proyectado | Métricas en vivo desde día 1, alerta si > $X/día |
| Audio latency en LATAM → quality issues | Telnyx tiene PoPs en Brasil/USA — testing temprano con vos para validar |
| Setter cierra browser durante llamada | Confirm dialog "tenés llamada activa, ¿salir?" + intento de mantener WebRTC peer alive |

---

## Open questions (a resolver en plan-phase)

- ¿Modelo de auth para WebRTC: cada setter tiene su propia API key de Telnyx, o el SCM hace proxy con una sola key del admin?
- ¿Webhook URL del SCM para recibir eventos: Railway puede recibir webhooks externos sin problema?
- ¿UI del botón Llamar también en view-crm (Setteo) o solo en view-calls? Probablemente solo Llamadas inicialmente.
- ¿Permitir llamar a leads que sí tienen WhatsApp (no solo sin_wsp)? Útil para closer cuando el lead no responde por chat.

---

## Referencias

- Telnyx docs: https://developers.telnyx.com/
- Telnyx WebRTC SDK: https://developers.telnyx.com/docs/voice/webrtc
- Pricing: https://telnyx.com/pricing
- Cold call framework (Connor Murray transcript): capturado en sesión 2026-05-21
- Módulo Llamadas existente: `index.js` líneas 4355-4470, `public/app.js`
  función `loadCallsView` línea 3188

---

*Captured: 2026-05-21*
