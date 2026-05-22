# 📞 Quickstart: Llamadas internacionales desde el SCM

Este módulo te permite **llamar a leads internacionales directo desde el browser**, sin usar tu celular personal. La clínica que llamés ve un número local (España, México, Colombia, etc.) → mucho más probable que atienda.

---

## 🎤 Primera vez: dar permiso de micrófono

La primera vez que hagas clic en "📞 Llamar", el browser te va a pedir permiso para usar el micrófono. **Tenés que aceptar**, sino no se puede hablar.

### Si lo rechazaste sin querer
1. Click en el **ícono de candado 🔒** a la izquierda de la URL del SCM
2. Buscá "Micrófono" → cambialo a **"Permitir"**
3. Recargá la página

### Recomendaciones
- **Usá auriculares con micrófono** (los del celular sirven). El mic del notebook tiene eco.
- Cerrá apps que usen el mic (Zoom, Meet, Discord) antes de llamar — pueden bloquear el acceso.
- Probá en Chrome o Firefox — son los más confiables.

---

## 🚀 Hacer una llamada

1. Andá a **Llamadas** en el sidebar (lista de leads sin WhatsApp)
2. Encontrá el lead que querés llamar. Cada fila tiene un botón **"📞 Llamar"** verde.
3. **Click en el botón verde**.
4. Permití el micrófono si todavía no lo hiciste.
5. Va a aparecer un **panel flotante abajo a la derecha** con:
   - Nombre del lead
   - Estado: "Conectando…" → "Sonando…" → "En llamada"
   - Timer (mm:ss)
   - Tu número saliente (caller ID que ve el receptor)
   - 3 botones: **Guion**, **Mute**, **Colgar**

### ¿Cómo sé desde qué número saliente estoy llamando?
Lo ves abajo del nombre del lead en el panel, ej: *"España principal — +34 91 1234 5678"*. El admin lo configuró según el país del lead que llamás.

---

## 📝 Usar el panel de guion durante la llamada

Mientras hablás, hacé click en **"📝 Guion"** en el panel de llamada. Te aparece un panel a la izquierda con:
- **Tabs por categoría**: 🎯 Apertura · 🛡️ Objeción · 🔄 Callback · 📅 Cerrar · 📭 Buzón
- **Texto del guion** seleccionado, con tus datos del lead ya rellenados (nombre, ciudad, tu nombre)
- Botón **"📋 Copiar"** por si lo querés pegar en otro lado

### Cómo usarlo
- **Si es primera llamada** → tab "🎯 Apertura" → leé el opener (sin sonar leído)
- **Si te ponen objeción** → tab "🛡️ Objeción" → buscá la que apareció ("ya tengo sistema", "no tengo tiempo", etc.)
- **Si te piden agendar** → tab "📅 Cerrar" → leé el cierre con la fecha/hora propuesta
- **Si entra a buzón de voz** → tab "📭 Buzón" → dejá el mensaje corto

### Variables auto-completadas
Los guiones usan variables tipo `{name}`, `{city}`, `{setterName}` que se llenan **automáticamente** con los datos del lead actual. No tenés que pensar en eso — solo lee.

---

## 🎤 Mute (silenciar)

El botón **"🎤 Mute"** silencia tu micrófono temporalmente. Útil si:
- Tosés / estornudás
- Tu compañero te interrumpe con algo
- Estás tomando notas y querés que el receptor no escuche el teclado

Click otra vez (ahora dice **"🔇 Unmute"** y está violeta) para volver a hablar. El receptor sigue escuchándote a vos solo cuando este botón está en "🎤 Mute" (gris).

---

## 📵 Colgar

Click en el botón rojo **"📵 Colgar"** termina la llamada inmediatamente.

### Qué pasa después de colgar
1. El panel se cierra automáticamente
2. La fila del lead se **resalta con un borde violeta pulsante** (3 pulsos)
3. Tu pantalla scrollea automáticamente al dropdown de resultado del lead
4. El dropdown queda en foco (listo para que elijas)

**Importante: marcá el resultado ANTES de pasar al siguiente lead.** Si no, el sistema no sabe cómo te fue (no atendió / interesado / no interesado / etc.) y no se registra la duración ni el costo de la llamada.

---

## 🛡️ Manejo de objeciones (resumen del framework)

Las objeciones más comunes y cómo responder (todas están en el script panel):

### "Ya tengo un sistema"
- **NO vendas tu sistema.** Decí: *"Justo por eso. Trabajamos con clínicas que ya tienen sistema — a veces hay gaps. Si no hay fit, igual quedamos en contacto. ¿Te tomo 20 minutos el jueves?"*
- La idea: **doblar la apuesta sobre la reunión, no sobre la solución.**

### "No tengo tiempo"
- *"15 minutos máximo, 2-3 cosas concretas. ¿Final del día te viene mejor?"*

### "Mandame info por mail"
- *"Por supuesto, pero prefiero 15 min para entender qué necesita y mandarle solo lo que aplica. ¿Mañana o el miércoles?"*

### "No me interesa"
- Aceptalo. NO insistas. Marcá "No interesado" en el disposition. Pasá al siguiente.

---

## 📊 Tu performance

El admin ve métricas (llamadas, minutos, costo USD) en su panel. Vos podés ver tu progreso en:
- **Mi rendimiento** → vista propia con KPIs
- **Llamadas (stats arriba)** → llamadas hoy, % atendidas, agendadas, pendientes

---

## ⚠️ Cosas que NO hacer

| ❌ No hagas | Por qué |
|---|---|
| Cerrar el browser durante una llamada activa | Te corta la llamada. El sistema te avisa antes de cerrar, pero igual cuidado. |
| Llamar desde celular usando este sistema | Está pensado para escritorio + browser. En celular no anda bien. |
| Saltar el disposition después de colgar | El callLog queda incompleto, no se registra duración ni costo, las stats salen mal. |
| Llamar al mismo lead 5 veces el mismo día | Espacialo mínimo 24-48 hs entre intentos. Anota en el callback. |
| Leer el guion como un robot | Es solo referencia. Adaptalo, hacelo natural. Tono > script (95% del éxito). |

---

## 🆘 Troubleshooting

### "No se puede iniciar la llamada"
- Verificá que tenés permiso de mic (candado de la URL)
- Refrescá la página con Ctrl+Shift+R
- Si sigue → avisale al admin que Telnyx puede tener problemas de creds

### "No hay número configurado para este destino"
- El admin no cargó un número saliente para ese país
- O no configuró un "default" como fallback
- Avisale al admin con el país del lead

### El receptor no me escucha
- Mirá el botón Mute — si está violeta y dice "Unmute" → estás silenciado, dale click
- Probá auriculares distintos (a veces el browser elige el mic equivocado)
- Refresca la página y volvé a permitir el mic

### Audio entrecortado o eco
- Cerrá otras pestañas pesadas (YouTube, video calls)
- Probá con cable de red en vez de WiFi
- Si seguís en LATAM con destino España → puede ser latencia del PoP. Avisale al admin para que evalúe.

### "Tu sesión expiró durante la llamada"
- Raro pero posible. El sistema te debería avisar y permitirte renovar. Si no, refrescá la página y volvé a loguearte.

---

## 💡 Tips para que más leads te atiendan

1. **Horarios óptimos** (clínicas dentales): martes-jueves, 10-12am o 4-6pm hora local del lead
2. **No llames lunes a la mañana** ni viernes a la tarde (consultas saturadas o cierran temprano)
3. **Después de 3 intentos sin atender** → marcalo como "callback later" con fecha + 1 semana en vez de seguir gastando llamadas
4. **Si entra a buzón** → dejá mensaje (el de "voicemail" en el script panel), no cuelgues silenciosamente. El que deja mensaje es 2× más recordado.

---

*Última actualización: 2026-05-21 (Phase 6 release).*
*Dudas / bugs → avisale al admin.*
