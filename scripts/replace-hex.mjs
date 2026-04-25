// Helper one-shot: reemplaza hex literales en public/app.js por CSS variables
// según la paleta SCM Design System v1.1. NO modifica lógica.
import fs from 'node:fs';
import path from 'node:path';

const file = 'public/app.js';
let s = fs.readFileSync(file, 'utf8');
let total = 0;

const replacements = [
  ['#5bb974', 'var(--success)'],
  ['#25d366', 'var(--success)'],
  ['#f85149', 'var(--danger)'],
  ['#e74c3c', 'var(--danger)'],
  ['#e3b341', 'var(--warning)'],
  ['#d29922', 'var(--warning)'],
  ['#79b8ff', 'var(--info)'],
  ['#a8c7fa', 'var(--accent)'],
  ['#1877f2', 'var(--info)'],
  ['#e1306c', 'var(--accent)'],
  ['#A78BFA', 'var(--accent)'],
  ['#a78bfa', 'var(--accent)'],
  ['#d2a8ff', 'var(--accent-hover)'],
  ['#f8514933', 'var(--danger-soft)'],
];

for (const [from, to] of replacements) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'gi');
  const matches = s.match(re);
  if (matches) {
    s = s.replace(re, to);
    console.log(`  ${from} → ${to}  (${matches.length}x)`);
    total += matches.length;
  }
}

fs.writeFileSync(file, s, 'utf8');
console.log(`Total: ${total}`);
