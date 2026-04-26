#!/usr/bin/env node
/**
 * Seed inicial del Banco de Respuestas con 18 entradas.
 * - 12 literales del Módulo 7 del onboarding (objeciones oficiales SCM)
 * - 6 inferidas siguiendo el patrón V→R→R y el tono del manual
 *
 * Uso (con env vars):
 *   RAILWAY_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/seed-faqs.mjs
 *
 * Por defecto NO duplica: si ya existe una entrada con la misma pregunta (case-insensitive),
 * la saltea.
 */

const RAILWAY_URL = (process.env.RAILWAY_URL || '').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

if (!RAILWAY_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Faltan env vars: RAILWAY_URL, ADMIN_EMAIL, ADMIN_PASSWORD');
  process.exit(1);
}

const ENTRIES = [
  // ── LITERALES DEL MANUAL (Módulo 7) ──
  { categoria: 'objecion', tags: ['info','evasion','pasame-algo'],
    pregunta: '¿Me podés pasar info? / Mandame algo',
    respuesta: 'Sí, igual depende bastante de cómo trabajen hoy. Si te mando info genérica capaz no aplica para tu caso.\n\n¿Te ofrezco una llamada corta para entender la situación específica y ahí te paso lo que sí aplica?' },
  { categoria: 'objecion', tags: ['competencia','agencia','marketing'],
    pregunta: 'Ya trabajo con alguien de marketing / Ya tengo agencia',
    respuesta: 'Buenísimo. Igual esto no es marketing ni publicidad. Es un sistema que trabaja la base de pacientes que ya tenés y que hoy probablemente nadie está siguiendo.\n\nEs complementario. ¿Te interesa ver cómo funciona?' },
  { categoria: 'objecion', tags: ['ya-lo-hacemos','sistema-actual'],
    pregunta: 'Eso ya lo hacemos',
    respuesta: 'Buenísimo. ¿Hoy lo tienen trabajado con un sistema armado o más manual desde el equipo?' },
  { categoria: 'objecion', tags: ['no-interesa','cierre-amable'],
    pregunta: 'No me interesa',
    respuesta: 'De una, no hay drama. Si más adelante querés ver cómo trabajar mejor la base de pacientes o automatizar ese seguimiento, escribime. Éxitos.' },
  { categoria: 'objecion', tags: ['whatsapp','automatizacion','llamadas'],
    pregunta: 'No usamos WhatsApp / no quiero automatizar',
    respuesta: 'Se entiende. Igual no necesariamente tiene que ir por WhatsApp. También trabajamos con llamadas con IA o seguimiento por otras vías según cómo se maneje mejor la clínica.\n\n¿Te muestro las opciones en una llamada?' },
  { categoria: 'precio', tags: ['precio','costo','agendar'],
    pregunta: '¿Cuánto sale? / ¿Cuánto cuesta?',
    respuesta: 'Depende bastante de cómo trabajen hoy seguimiento y base. Justamente eso lo vemos en la llamada con Ignacio.\n\n¿Te ofrezco mañana 10am o jueves 4pm?' },
  { categoria: 'precio', tags: ['caro','presupuesto','roi'],
    pregunta: 'Es caro / fuera de presupuesto',
    respuesta: 'Entiendo. ¿Caro en relación a qué? Te pregunto porque depende mucho de cuánto está perdiendo la clínica hoy con los pacientes que no vuelven.\n\n¿Te ofrezco la llamada y vemos los números reales?' },
  { categoria: 'calificacion', tags: ['presentacion','quien-sos'],
    pregunta: '¿Quién sos? / ¿De parte de quién?',
    respuesta: 'Sí, perdón. Soy [Nombre], trabajo con un equipo que ayuda a clínicas dentales con un sistema de seguimiento de pacientes.\n\nTe quería hacer una pregunta corta sobre cómo trabajan ustedes, ¿te interesa que te cuente o mejor hablamos otro día?' },
  { categoria: 'calificacion', tags: ['decisor','no-decisor','consultar'],
    pregunta: 'Eso lo ve otra persona / tengo que consultarlo',
    respuesta: 'Perfecto. ¿Con quién tendría más sentido verlo entonces para no hacerte perder tiempo?\n\n¿Me podés pasar contacto o preferís coordinarlo vos?' },
  { categoria: 'seguimiento', tags: ['tiempo','callback','ocupado'],
    pregunta: 'No tengo tiempo ahora / estoy muy ocupado',
    respuesta: 'De una. ¿Te escribo el lunes y vemos si cuadra hablar de esto con calma?' },
  { categoria: 'general', tags: ['que-es','como-funciona','agendar'],
    pregunta: '¿De qué se trata? / ¿Cómo funciona?',
    respuesta: 'Te lo explico mejor en una llamada corta de 20 minutos, así te muestro cómo lo estamos haciendo con otras clínicas.\n\n¿Te queda mejor mañana 10am o jueves 4pm?' },
  { categoria: 'general', tags: ['prueba-social','casos','funciona'],
    pregunta: '¿Esto realmente funciona? / ¿Tienen casos?',
    respuesta: 'Sí. Tenemos clientes activos hoy y el sistema está generando agendas reales todas las semanas.\n\nLos números los ve Ignacio en la llamada porque depende del caso de cada clínica. ¿Te ofrezco mañana 10am o jueves 4pm?' },
  // ── INFERIDAS (siguiendo patrón V→R→R y tono del manual) ──
  { categoria: 'objecion', tags: ['clinica-nueva','sin-base'],
    pregunta: 'No tengo base de pacientes / es una clínica nueva',
    respuesta: 'Se entiende. En ese caso el sistema arranca desde otro lado: confirmaciones, no-shows y captación de los nuevos que van entrando.\n\n¿Te muestro cómo se vería para un caso así en una llamada corta?' },
  { categoria: 'objecion', tags: ['spam','molestar','intrusivo'],
    pregunta: 'No quiero molestar a mis pacientes',
    respuesta: 'Buen punto. Justamente el sistema está pensado para no spamear: respeta tiempos, deja de insistir si no hay respuesta y se siente como atención personal, no como publicidad.\n\n¿Te muestro un ejemplo real en una llamada?' },
  { categoria: 'objecion', tags: ['malas-experiencias','fallo-previo'],
    pregunta: 'Probé algo parecido y no funcionó',
    respuesta: 'Se entiende. Pasa seguido. La diferencia normalmente está en el seguimiento sostenido y en cómo se trabaja la base existente, no sólo en captar nuevos.\n\n¿Te ofrezco la llamada y vemos qué se hizo distinto y qué se podría ajustar?' },
  { categoria: 'precio', tags: ['precio','plan','modalidad'],
    pregunta: '¿Tienen plan mensual? ¿Cómo cobran?',
    respuesta: 'El esquema lo arma Ignacio en la llamada según el tamaño de la clínica y qué fases activamos.\n\n¿Te queda mejor mañana 10am o jueves 4pm para verlo?' },
  { categoria: 'calificacion', tags: ['decisor','derivar'],
    pregunta: 'No soy yo el que toma esas decisiones',
    respuesta: 'Sin drama. ¿Quién sería la persona indicada en la clínica para ver este tema?' },
  { categoria: 'seguimiento', tags: ['ocupado','callback'],
    pregunta: 'Ahora estoy en consulta / no puedo hablar',
    respuesta: 'Dale, sin problema. ¿A qué hora te queda mejor que te escriba más tarde?' },
];

async function main() {
  console.log(`\n=== SEED FAQs → ${RAILWAY_URL} ===\n`);

  // Login
  const loginResp = await fetch(`${RAILWAY_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    redirect: 'manual'
  });
  if (!loginResp.ok && loginResp.status !== 302) {
    console.error(`Login fallo (${loginResp.status}): ${await loginResp.text()}`);
    process.exit(1);
  }
  const setCookie = loginResp.headers.getSetCookie?.() || [];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).map(c => c.split(';')[0]).join('; ');
  if (!cookie) { console.error('No se recibió cookie de sesión.'); process.exit(1); }
  console.log('✓ Login OK\n');

  // Pre-fetch entradas existentes para dedup por pregunta
  const existing = await fetch(`${RAILWAY_URL}/api/faqs`, { headers: { Cookie: cookie } });
  const existingJson = existing.ok ? await existing.json() : { entries: [] };
  const existingPreguntas = new Set((existingJson.entries || []).map(e => (e.pregunta || '').toLowerCase().trim()));
  console.log(`Banco actual: ${existingJson.entries?.length || 0} entradas\n`);

  let created = 0, skipped = 0, failed = 0;
  for (const entry of ENTRIES) {
    const key = entry.pregunta.toLowerCase().trim();
    if (existingPreguntas.has(key)) {
      console.log(`  ⊘ skip (ya existe): ${entry.pregunta.substring(0, 60)}`);
      skipped++;
      continue;
    }
    const r = await fetch(`${RAILWAY_URL}/api/faqs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(entry)
    });
    if (r.ok) {
      console.log(`  ✓ creado [${entry.categoria}]: ${entry.pregunta.substring(0, 60)}`);
      created++;
    } else {
      console.error(`  ✗ ERROR (${r.status}) en "${entry.pregunta}": ${await r.text()}`);
      failed++;
    }
  }
  console.log(`\nResumen: ${created} creadas · ${skipped} ya existian · ${failed} fallaron\n`);
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
