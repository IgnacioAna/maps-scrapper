# Manual del Admin — SCM

Guía para vos (Ignacio) sobre cómo operar el sistema completo desde el panel.

URL del panel: **https://scm-setting.up.railway.app/**
Login: tu mail + tu contraseña.

---

## Estructura del sistema

El sidebar tiene 3 grupos:

### Búsqueda
- **Google Maps** — scrapeás clínicas dentales (SerpAPI). Acá creás la base de leads.
- **Redes** — scraping de Instagram (Apify). Para leads que vienen por redes.

### Setters
- **Setteo (WhatsApp)** — el panel principal. Tabla de todos los leads, filtros por estado, botones para abrir WhatsApp por lead, asignar variantes, etc.
- **Llamadas (Sin WSP)** — leads marcados como "sin WhatsApp" caen acá para llamarlos.
- **Banco de Respuestas** — FAQs / objeciones / respuestas para que el setter copie. Búsqueda + IA.
- **Centro de Entrenamiento** — 8 módulos de onboarding con quizzes para que cada setter aprenda el sistema.

### Administración
- **Centro de Comando** — gestión de variantes (Var I, II, III, IV) y cómo se asignan a cada setter.
- **Dashboard WA** — métricas de las cuentas WhatsApp Multi-cuenta.
- **Cuentas WA** — pool de números de WhatsApp para warming.
- **Rutinas Warming** — definición de fases de calentamiento.
- **Quién está conectado** — usuarios online ahora.
- **Configuración** — ajustes de APIs.

---

## Flujo típico de prospección (cómo trabajan tus setters)

### 1. Vos generás leads
- Entrás a **Google Maps**.
- Ponés keywords ("clínica dental", "consultorio odontológico") y ciudades/países.
- Click "Iniciar Extracción Maps". Esperás unos minutos.
- Filtrás "Solo nuevos" + "Solo Wsp" para ver solo leads útiles.
- Opcional: click "Escanear con IA" para enriquecer con sitio web, redes, dueño, mensaje de apertura.
- Click "Enviar a Setters". Los leads quedan distribuidos automáticamente.

### 2. Asignás variantes
- Entrás a **Centro de Comando**.
- Cada setter (Paula, Evelio, Tiago, Leandro) tiene 4 slots (Var I, II, III, IV).
- Cada variante tiene 4 bloques: Apertura → Problema → Prueba social → Cierre/Pregunta.
- Asignás las variantes activas de la semana a cada setter.
- Mirás "Rendimiento por Variante" y "Rendimiento por Setter" para ver cuál convierte mejor.

### 3. Los setters laburan
- Cada setter entra a **Setteo (WhatsApp)** y ve sus leads asignados.
- Apreta "Abrir WhatsApp" por lead → se abre wa.me con el mensaje pre-armado.
- Marca el estado del lead: WSP enviado → Respondió → Calificado → Interesado → Agendado.
- Si no tiene WhatsApp, marca "Sin WSP" y el lead pasa a Llamadas.
- Si tiene dudas/objeciones, busca en el **Banco de Respuestas**.

### 4. Vos monitoreás
- En el header de Setteo: cards con TOTAL / CONEXIONES / APERTURA / CALIFICACIÓN / INTERESADOS / AGENDADOS.
- En **Quién está conectado** ves quién está laburando ahora.
- En **Centro de Comando** ves rendimiento por variante para iterar el mensaje.

---

## WhatsApp Multi-cuenta (warming + operación)

Esta parte es **opcional** y separada del flujo de Setteo. Sirve para:
- Calentar números nuevos antes de operar
- Hacer reactivación masiva de pacientes para clientes (clínicas)

### Crear una rutina de warming
1. **Rutinas Warming** → "+ Nueva rutina".
2. Click "Aplicar curva default" — usa la curva pragmática SCM:
   - Días 1-2: 12 msg/día, drip 60-120s
   - Días 3-5: 30 msg/día, drip 30-60s
   - Días 6-10: 80 msg/día, drip 15-30s
   - Días 11-14: 200 msg/día, drip 8-15s
   - Día 15+: 400 msg/día, drip 5-12s
3. En "Mensajes" pegás los textos a mandar (uno por línea, con variables si querés).
4. En "Targets" pegás los teléfonos (con código país, solo dígitos).
5. Activás "Auto-respuesta" si querés que conteste automáticamente a quien responda.
6. Guardar.

### Crear cuentas WA y asignarlas
1. **Cuentas WA** → "+ Nueva cuenta" → label (ej: "Ventas 01").
2. En la tabla, columna "Setter": elegís a qué setter pertenece.
3. Columna "Rutina": elegís la rutina que querés aplicarle.
4. Click "▶ Warm" → la cuenta entra en warming desde día 1.

### Comandos remotos
Botones en cada cuenta:
- **Abrir** — fuerza al setter a abrir esa sesión de WhatsApp Web.
- **Mensaje** — mandás un mensaje específico desde esa cuenta a un teléfono.
- **▶ Warm** — inicia la rutina de warming.
- **⏸** — detiene la rutina.
- **↺** — reinicia warming desde día 1 (después de un ban temporal por ej.).

### Selección múltiple (bulk)
Marcás varias cuentas → barra azul aparece arriba → elegís acción (Abrir / Cerrar / Iniciar warming / Detener) → Ejecutar. Cada cuenta dispatcheada al setter dueño.

### Detección de ban
Si una cuenta empieza a tener mensajes pendientes >5min o aparece banner de "número bloqueado":
- El sistema detecta automáticamente y pasa la cuenta a status `BANNED_TEMP`.
- Aparece un cooldown (default 4 días) durante el cual no se le manda nada.
- Cuando pasa el cooldown, podés clickear "↺" para reiniciar warming desde día 1.

---

## Tareas administrativas

### Crear setters nuevos
1. **Centro de Comando** → "Equipo de setters" → "+ Nuevo setter".
2. Ponés nombre, email.
3. El sistema genera una invitación. La copiás y se la mandás al setter.
4. El setter abre el link, crea su contraseña, y queda activo.

### Configurar variantes
1. **Centro de Comando** → click en una variante existente, o "+ Nueva variable".
2. Editás los 4 bloques (Apertura, Problema, Prueba social, Cierre).
3. Asignás "Setter dueño" + opcionalmente "Compartir con otros setters".
4. Guardás.

### Importar leads desde CSV
1. **Setteo (WhatsApp)** → "Importar CSV" → seleccionás archivo.
2. El CSV detecta automáticamente columnas comunes (nombre, teléfono, ciudad, país, etc.).
3. Asignás a un setter específico.
4. Los leads aparecen en su panel.

### Limpiar duplicados
- En **Setteo** click "Limpiar duplicados" — elimina dups por teléfono normalizado.
- En **Configuración** podés correr dedup global del history.

---

## Antes de cada deploy a Railway (importante)

```bash
cd C:\Users\Usuario\OneDrive\Desktop\GoogleSrapper
npm run pre-deploy
# pide URL Railway, email y password admin
# guarda data actual para no perder leads scrapeados
git add data/
git commit -m "backup data"
git push origin main && git push origin main:master
```

Si NO hacés `pre-deploy`, los leads scrapeados desde el último deploy se pierden cuando Railway recargue del repo.

---

## Métricas que importan

Cards del header en Setteo:
- **TOTAL** — leads asignados al setter activo (o todos si sos admin).
- **CONEXIONES %** — qué porcentaje recibió mensaje (conexión enviada / total).
- **APERTURA %** — respondieron / conexiones enviadas.
- **CALIFICACIÓN %** — calificados / respondieron.
- **INTERESADOS** — número absoluto.
- **AGENDADOS** — la métrica de oro. Es el card destacado.

Para ver rendimiento histórico por variante: **Centro de Comando → Rendimiento por Variante**.

---

## Cuando algo se rompe

- **Server caído**: Railway dashboard → restart.
- **Lead no aparece**: chequear `data/setters.json` en Railway (está commiteado en el repo después de cada pre-deploy).
- **Setter no puede entrar**: chequear que su user esté en `data/auth.json` con `status: "active"`. Si la sesión venció, que vuelva a loguear.
- **Cuenta WA en BANNED_TEMP**: esperar el cooldown o forzar reset desde el panel.
