// Generates simple SVG avatar placeholders. Run with `npm run gen:images`.
// Replace any file in public/images/avatars/** with an AI-generated image of
// the same name once ready -- no other code needs to change.
const fs = require('fs');
const path = require('path');

const AVATARS_DIR = path.join(__dirname, '..', 'public', 'images', 'avatars');

const people = [
  { file: 'meera.svg', label: 'meera' },
  { file: 'rahul.svg', label: 'rahul' },
  { file: 'nikhil.svg', label: 'nikhil' },
  { file: 'priya.svg', label: 'priya' },
  { file: 'arjun.svg', label: 'arjun' },
];

const groups = [{ file: 'group-college.svg', label: 'College Batch' }];

const filler = [
  { file: 'prime-bank.svg', label: 'Prime Bank' },
  { file: 'quickcart.svg', label: 'QuickCart' },
  { file: 'greenleaf.svg', label: 'GreenLeaf' },
  { file: 'unknown.svg', label: 'Unknown' },
];

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function personSvg({ label }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#2c313c"/>
  <circle cx="100" cy="78" r="34" fill="#4b5563"/>
  <rect x="46" y="118" width="108" height="64" rx="32" fill="#4b5563"/>
  <text x="100" y="192" font-family="sans-serif" font-size="12" fill="#9aa0a6" text-anchor="middle">${esc(label)}</text>
</svg>`;
}

function groupSvg({ label }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#1f2a2a"/>
  <circle cx="76" cy="82" r="26" fill="#3f7a6d"/>
  <circle cx="128" cy="82" r="26" fill="#4f9284"/>
  <rect x="40" y="120" width="120" height="56" rx="28" fill="#3f7a6d"/>
  <text x="100" y="192" font-family="sans-serif" font-size="11" fill="#9fb8b1" text-anchor="middle">${esc(label)}</text>
</svg>`;
}

function fillerSvg({ label }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#33302a"/>
  <rect x="50" y="60" width="100" height="80" rx="10" fill="#6b6355"/>
  <text x="100" y="192" font-family="sans-serif" font-size="11" fill="#a89d89" text-anchor="middle">${esc(label)}</text>
</svg>`;
}

fs.mkdirSync(AVATARS_DIR, { recursive: true });

for (const p of people) fs.writeFileSync(path.join(AVATARS_DIR, p.file), personSvg(p));
for (const g of groups) fs.writeFileSync(path.join(AVATARS_DIR, g.file), groupSvg(g));
for (const f of filler) fs.writeFileSync(path.join(AVATARS_DIR, f.file), fillerSvg(f));

console.log(`Generated ${people.length} person, ${groups.length} group, ${filler.length} filler avatars.`);
