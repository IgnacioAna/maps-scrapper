// One-shot: saca emojis decorativos del frontend (app.js + index.html), con criterio.
// CONSERVA: banderas de pais (regional indicators) y warnings (se protegen y restauran).
// SACA: el resto de emojis (decorativos en botones/labels/headers/nav/toasts).
// Uso: node scripts/strip-emojis-ui.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');
const files = ['public/app.js', 'public/index.html'];

// Emoji que PREFIJA texto: secuencia de emoji + espacio(s), SOLO si lo que sigue
// no es '<' (así NO tocamos íconos solos como <span>📅</span> ni FABs). Esto saca
// el garnish ("📞 Llamar" -> "Llamar") y conserva la iconografía standalone.
const EMOJI_SEQ = /(\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|[️\u{1F3FB}-\u{1F3FF}])*)[ \t]+(?!<)/gu;
// Banderas (no son Extended_Pictographic -> ya quedan a salvo). Solo se cuentan.
const FLAG = /\p{Regional_Indicator}\p{Regional_Indicator}/gu;
const SENT = 'ZZWARNZZ'; // sentinel: no aparece en el codigo real

for (const rel of files) {
  const fp = path.join(process.cwd(), rel);
  const src = fs.readFileSync(fp, 'utf8');
  const flagsBefore = (src.match(FLAG) || []).length;
  // Proteger advertencias (U+26A0 con o sin variation selector) antes de stripear.
  let work = src.replace(/⚠️?/g, SENT);
  const emojiCount = (work.match(EMOJI_SEQ) || []).length;
  work = work.replace(EMOJI_SEQ, '');
  work = work.split(SENT).join('⚠️'); // restaurar como ⚠️
  const flagsAfter = (work.match(FLAG) || []).length;
  console.log(`${rel}: emojis_sacados=${emojiCount} | banderas=${flagsBefore}->${flagsAfter}`);
  if (WRITE) fs.writeFileSync(fp, work, 'utf8');
}
console.log(WRITE ? 'ESCRITO.' : '(dry-run; agrega --write para aplicar)');
