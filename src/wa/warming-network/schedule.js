/**
 * schedule.js
 *
 * Calcula CUÁNDO debe mandarse el próximo mensaje de un par. La idea
 * es simular cadencia humana realista, no un drip robotizado.
 *
 * Factores que afectan el timing:
 *   - Hora actual local del setter (no chatear a las 3am)
 *   - Active window de la persona ficticia (mañanero/diurno/etc.)
 *   - Reply speed de la persona (rápido/medio/lento/irregular)
 *   - Si es el primer mensaje del día vs respuesta inmediata a algo
 *   - Variabilidad gaussiana (no siempre el mismo delay)
 */

const HOUR_MS = 3600 * 1000;
const MIN_MS = 60 * 1000;

/**
 * @param {Date} now
 * @param {string} timezone - default Argentina
 * @returns {number} hora local 0-23
 */
function localHour(now, timezone) {
  try {
    return parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone || "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        hour12: false,
      }).format(now),
      10,
    );
  } catch {
    return now.getHours();
  }
}

/**
 * ¿La persona está dentro de su active window ahora?
 */
function isPersonaActiveNow(persona, now) {
  const hour = localHour(now, "America/Argentina/Buenos_Aires");
  const win = persona.activeWindowConfig;
  if (!win) return true;
  const inPeak = hour >= win.peakStart && hour <= win.peakEnd;
  const inSecondary =
    win.secondaryStart >= 0 && hour >= win.secondaryStart && hour <= win.secondaryEnd;
  return inPeak || inSecondary;
}

/**
 * ¿Hora "humanamente decente"? (no mensajes a las 3am ni 5am)
 */
function isHumanHour(hour) {
  return hour >= 8 && hour <= 23;
}

// Override de speed para cuentas en modo boost. Independiente de su replySpeed
// natural — siempre 'rápido' (1-30 min) mientras esta boost activo.
const BOOST_SPEED = { minMin: 1, maxMin: 30 };

/**
 * Calcula próximo timestamp en que debe mandar mensaje el sender.
 *
 * @param {object} senderPersona
 * @param {object} pair - el par actual con history
 * @param {Date} now
 * @param {object} opts
 * @param {boolean} opts.boost - si true, ignora replySpeed natural y usa BOOST_SPEED
 * @returns {Date} próximo action time
 */
export function computeNextActionAt(senderPersona, pair, now = new Date(), opts = {}) {
  let speedConfig = senderPersona.replySpeedConfig;
  if (opts.boost) speedConfig = BOOST_SPEED;
  const minMin = speedConfig.minMin;
  const maxMin = speedConfig.maxMin;

  // Sample con sesgo gaussiano hacia el medio (Box-Muller aproximado: promedio
  // de 3 uniformes ~ campana centrada en 0.5). Genera un delay con tendencia
  // al medio del rango [minMin, maxMin] pero con colas suaves.
  const gauss = (Math.random() + Math.random() + Math.random()) / 3;
  const delayMin = minMin + (maxMin - minMin) * gauss;
  let target = new Date(now.getTime() + delayMin * MIN_MS);

  // Si target cae fuera de horas humanas, lo movemos al próximo slot decente
  // (en lugar de mandar mensajes a las 3am)
  let h = localHour(target, "America/Argentina/Buenos_Aires");
  let safety = 0;
  while (!isHumanHour(h) && safety++ < 24) {
    target = new Date(target.getTime() + HOUR_MS);
    h = localHour(target, "America/Argentina/Buenos_Aires");
  }

  // En modo boost saltamos el check de active window (queremos volumen rapido,
  // no respetar el patron horario humano)
  if (opts.boost) return target;

  // Adicional: si la persona NO está en active window y todavía falta mucho,
  // movemos al inicio de su próxima ventana
  if (!isPersonaActiveNow(senderPersona, target)) {
    const win = senderPersona.activeWindowConfig;
    if (win && win.peakStart >= 0) {
      // próxima vez que sea peakStart hs
      const next = new Date(target);
      const delta = (win.peakStart - h + 24) % 24;
      // Solo lo movemos si el delta no es enorme (sino, mejor mantenemos algo
      // razonable, no esperar 18hs)
      if (delta > 0 && delta < 16) {
        next.setHours(win.peakStart, Math.floor(Math.random() * 60), 0, 0);
        if (next < target) next.setTime(next.getTime() + 24 * HOUR_MS);
        target = next;
      }
    }
  }

  return target;
}

// NOTE (audit 2026-05-23): `computeFirstMessageAt` se eliminó por dead code —
// el primer mensaje (state PENDING_FIRST) lo agenda el store al crear el par
// con nextActionAt=now, y el orchestrator usa computeNextActionAt para todos
// los turnos. Si en el futuro se quiere un delay diferenciado para el primer
// mensaje, recuperarlo del git history.
