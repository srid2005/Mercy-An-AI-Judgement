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
  { file: 'manager.svg', label: 'manager' },
  { file: 'police.svg', label: 'police' },
];

const filler = [
  { file: 'urbansole.in.svg', label: 'urbansole.in' },
  { file: 'streambox.svg', label: 'StreamBox' },
  { file: 'workhive.svg', label: 'WorkHive' },
  { file: 'greenleaf.svg', label: 'GreenLeaf' },
  { file: 'spam.svg', label: '?!' },
  { file: 'kartly.svg', label: 'Kartly' },
  { file: 'pulsefit.svg', label: 'PulseFit' },
  { file: 'stillwell.svg', label: 'Stillwell' },
  { file: 'wanderly.svg', label: 'Wanderly' },
  { file: 'security.svg', label: 'Security' },
  { file: 'prime-bank.svg', label: 'Prime Bank' },
];

// Real evidence, but an untraceable identity -- styled distinctly (dark,
// ominous) from both the named cast and the filler senders.
const anonymous = [{ file: 'unknown.svg', label: '?' }];

// Haven: real evidence, and narratively important (the future cloud/video
// service). Styled distinctly again -- calm, trustworthy, cloud-like --
// so it visually stands apart from both the cast and generic filler.
const special = []; // Haven's avatar is its real logo (avatars/haven.png), not a placeholder

// Shopping-brand filler senders -- deliberately drawn as parody/spoof
// logos (evoking a familiar marketplace look without copying any real
// brand's actual wordmark or artwork), not the plain generic filler icon.
const brands = [
  { file: 'emazon.svg', kind: 'emazon' },
  { file: 'mamster.svg', kind: 'mamster' },
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

function fillerSvg({ label }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#33302a"/>
  <rect x="50" y="60" width="100" height="80" rx="10" fill="#6b6355"/>
  <text x="100" y="192" font-family="sans-serif" font-size="11" fill="#a89d89" text-anchor="middle">${esc(label)}</text>
</svg>`;
}

function anonymousSvg({ label }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#1a1212"/>
  <circle cx="100" cy="100" r="70" fill="none" stroke="#5a2e2e" stroke-width="2" stroke-dasharray="6,5"/>
  <text x="100" y="118" font-family="sans-serif" font-size="56" fill="#8a4a4a" text-anchor="middle">${esc(label)}</text>
</svg>`;
}

function specialSvg({ label }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#132621"/>
  <path d="M60 120 a30 30 0 0 1 8-58 a40 40 0 0 1 76 8 a26 26 0 0 1 -4 50 z" fill="#3fa88a"/>
  <text x="100" y="170" font-family="sans-serif" font-size="16" fill="#8fd9c4" text-anchor="middle">${esc(label)}</text>
</svg>`;
}

function emazonSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" rx="24" fill="#131921"/>
  <text x="100" y="104" font-family="Verdana, Arial, sans-serif" font-size="32" font-weight="700" fill="#ffffff" text-anchor="middle">emazon</text>
  <path d="M60 122 Q100 148 140 122" stroke="#ff9900" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M132 116 L142 122 L131 129" stroke="#ff9900" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function mamsterSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" rx="24" fill="#ff8a3d"/>
  <circle cx="100" cy="80" r="36" fill="#fff3e6"/>
  <circle cx="76" cy="54" r="12" fill="#fff3e6"/>
  <circle cx="124" cy="54" r="12" fill="#fff3e6"/>
  <circle cx="76" cy="55" r="6" fill="#ff8a3d"/>
  <circle cx="124" cy="55" r="6" fill="#ff8a3d"/>
  <circle cx="87" cy="84" r="5" fill="#3a2313"/>
  <circle cx="113" cy="84" r="5" fill="#3a2313"/>
  <ellipse cx="100" cy="95" rx="6" ry="4" fill="#3a2313"/>
  <text x="100" y="162" font-family="Verdana, Arial, sans-serif" font-size="24" font-weight="700" fill="#ffffff" text-anchor="middle">Mamster</text>
</svg>`;
}

const brandRenderers = { emazon: emazonSvg, mamster: mamsterSvg };

fs.mkdirSync(AVATARS_DIR, { recursive: true });

for (const p of people) fs.writeFileSync(path.join(AVATARS_DIR, p.file), personSvg(p));
for (const f of filler) fs.writeFileSync(path.join(AVATARS_DIR, f.file), fillerSvg(f));
for (const a of anonymous) fs.writeFileSync(path.join(AVATARS_DIR, a.file), anonymousSvg(a));
for (const s of special) fs.writeFileSync(path.join(AVATARS_DIR, s.file), specialSvg(s));
for (const b of brands) fs.writeFileSync(path.join(AVATARS_DIR, b.file), brandRenderers[b.kind]());

console.log(`Generated ${people.length} person avatars, ${filler.length} filler sender avatars, ${anonymous.length} anonymous avatar, ${special.length} special avatar, ${brands.length} spoof brand logos.`);
