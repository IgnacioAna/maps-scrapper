# Phase wa-multi-ux-redesign — VERIFICATION

**Fecha:** 2026-05-23
**Status:** ✅ PASS — buildeado y empacado como v0.5.3. Pendiente verificación manual del user.

## Lo que se hizo

### Build flow
1. Extraído app.asar de v0.5.2 a /tmp/wamulti-src
2. npm install --no-save de devDeps esenciales (electron-vite, vite, @vitejs/plugin-vue, typescript, vue-tsc) — 21s, 353 paquetes
3. Modificado source:
   - `src/renderer/index.html` — Geist font + CSS variables SCM + dark globals
   - `src/renderer/components/LoginView.vue` — branding SCM completo, sin Server URL
   - `src/renderer/components/AccountList.vue` — reescrito como dashboard
   - `src/renderer/components/AccountCard.vue` — NUEVO componente
   - `src/renderer/components/ActivityFeed.vue` — NUEVO componente
   - `package.json` — version bumped 0.5.2 → 0.5.3
4. `npx electron-vite build` — limpio, 4s renderer
5. Repackeado app.asar (981 MB)
6. Copiado v0.5.2 binario a v0.5.3 + reemplazado app.asar
7. Borrado v0.5.2 (ya superada, queda solo backup del original v0.5.1)
8. README.txt actualizado con changelog completo

### Componentes creados/modificados
- ✅ index.html con Geist + dark theme + Element Plus overrides
- ✅ LoginView: branded, Server URL oculto, status visible
- ✅ AccountList (dashboard): header con stats + lista de cards
- ✅ AccountCard: avatar pulse, chips estado, warming info, acciones
- ✅ ActivityFeed: colapsable, eventos en vivo, formato relativo

### Build verificado
- `out/renderer/index.html` tiene `Geist` references (2 matches)
- `out/renderer/assets/index-*.js` 2.4 MB (Vue + Element Plus + componentes nuevos)
- `out/renderer/assets/index-*.css` 353 KB
- app.asar nuevo: 981 MB

### Estado del disco
```
Desktop/wa-multi/                  2.4 GB total
├── README.txt                     1.7 KB (actualizado)
├── versiones/
│   └── wa-multi-portable-v0.5.3/  1.4 GB ← LA QUE USAR
└── backups/
    └── app.asar.v0.5.1-original   1.1 GB (rollback de emergencia)
```

## Verificación manual pendiente (Ignacio)

1. [ ] Cerrar wa-multi viejo si está abierto
2. [ ] Abrir: `Desktop/wa-multi/versiones/wa-multi-portable-v0.5.3/wa-multi-win32-x64/wa-multi.exe`
3. [ ] **Login screen** debe verse:
   - Fondo dark con sutil gradient violeta
   - Card centrada con logo S violeta + "SCM Sales Closing Machine"
   - Solo 2 inputs: Email y Contraseña (no más Server URL visible)
   - Botón "Ingresar →" violeta grande
   - Footer con "Configuración avanzada" colapsable
4. [ ] Login con tus creds
5. [ ] **Dashboard** debe verse:
   - Header con logo S + "SCM wa-multi" + usuario · rol
   - Botones header: 📡 Actividad / ↻ Refrescar / ⏏ Salir
   - Stats arriba: cards con Cuentas / Calentando / Pendientes / Mensajes hoy
   - Cuentas como cards (no tabla):
     · Avatar circular con inicial violeta + emoji estado
     · Pulse animation si está conectada
     · Chip status (verde/amarillo/rojo)
     · Botones Abrir/Cerrar
   - Footer con versión + URL del server
6. [ ] **Activity feed**:
   - Click "📡 Actividad" → se abre panel lateral derecho
   - Muestra mensaje inicial "Feed de actividad iniciado…"
   - Click "✕" cierra el panel
7. [ ] Probar abrir una cuenta de WhatsApp — debe funcionar igual que v0.5.2

## Si algo falla

### Rollback rápido
1. Borrar `Desktop/wa-multi/versiones/wa-multi-portable-v0.5.3/`
2. Re-extraer de backup: usar `backups/app.asar.v0.5.1-original-backup-...`
3. O reportar el bug y aplicamos hotfix v0.5.4

### Debug
- Logs de la app: F12 en wa-multi para abrir DevTools (Ctrl+Shift+I)
- Si error de fuente Geist: verificar conexión a internet (Google Fonts CDN)
- Si error de CSP: verificar headers Content-Security-Policy en index.html

## Out of scope (queda para futuro)

- System tray + minimize-to-tray (mencionado en PLAN.md pero no implementado en v0.5.3)
- Onboarding placeholders más detallados
- Modo claro / toggle de tema
- Light theme
- Multi-language (español hardcoded por ahora)
- Drag&drop reorder cuentas

## Riesgos detectados

1. **Element Plus override de CSS** — solo cubre inputs y form labels. Otros componentes (table, dialog, etc.) pueden verse desalineados con el dark theme.
2. **Google Fonts CDN** — si el setter no tiene internet al abrir, fallback a system-ui. No crítico.
3. **Tamaño del bundle JS** — 2.4 MB, aceptable para Electron.
