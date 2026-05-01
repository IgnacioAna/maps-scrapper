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

/**
 * Calcula próximo timestamp en que debe mandar mensaje el sender.
 *
 * @param {object} senderPersona
 * @param {object} pair - el par actual con history
 * @param {Date} now
 * @returns {Date} próximo action time
 */
export function computeNextActionAt(senderPersona, pair, now = new Date()) {
  const speedConfig = senderPersona.replySpeedConfig;
  const minMin = speedConfig.minMin;
  const maxMin = speedConfig.maxMin;

  // Sample con sesgo gaussiano hacia el medio
  const u = Math.random();
  // Box-Muller approx → un poco de cola pero centrado
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

/**
 * Para el primerísimo mensaje del par (state === PENDING_FIRST), usamos un
 * delay más corto para que el par no quede vivo eternamente sin actividad.
 */
export function computeFirstMessageAt(senderPersona, now = new Date()) {
  // 1-30 minutos para arrancar el primer chat (variando por persona)
  const baseMin = 1 + Math.floor(Math.random() * 30);
  let target = new Date(now.getTime() + baseMin * MIN_MS);
  let h = localHour(target, "America/Argentina/Buenos_Aires");
  let safety = 0;
  while (!isHumanHour(h) && safety++ < 24) {
    target = new Date(target.getTime() + HOUR_MS);
    h = localHour(target, "America/Argentina/Buenos_Aires");
  }
  return target;
}
