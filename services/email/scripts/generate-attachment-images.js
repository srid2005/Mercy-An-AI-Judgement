// Generates simple, on-topic SVG illustrations for email attachments, so
// each attachment actually depicts what its filename says (a picsum.photos
// random stock photo doesn't -- it's not keyword-aware, so a "hamster
// habitat" attachment could just as easily come back as a beach photo).
// Run with `npm run gen:attachments`.
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'attachments');

const files = {
  'headphones.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">
  <rect width="500" height="500" fill="#eef1f6"/>
  <path d="M120 260 a130 130 0 0 1 260 0" fill="none" stroke="#2b2f38" stroke-width="18" stroke-linecap="round"/>
  <rect x="95" y="250" width="55" height="90" rx="20" fill="#2b2f38"/>
  <rect x="350" y="250" width="55" height="90" rx="20" fill="#2b2f38"/>
  <rect x="105" y="265" width="35" height="60" rx="12" fill="#5b6472"/>
  <rect x="360" y="265" width="35" height="60" rx="12" fill="#5b6472"/>
</svg>`,

  'hamster-cage.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">
  <rect width="500" height="500" fill="#fff3e2"/>
  <rect x="90" y="120" width="320" height="230" rx="14" fill="none" stroke="#c9925a" stroke-width="10"/>
  <line x1="120" y1="120" x2="120" y2="350" stroke="#c9925a" stroke-width="6"/>
  <line x1="160" y1="120" x2="160" y2="350" stroke="#c9925a" stroke-width="6"/>
  <line x1="200" y1="120" x2="200" y2="350" stroke="#c9925a" stroke-width="6"/>
  <line x1="240" y1="120" x2="240" y2="350" stroke="#c9925a" stroke-width="6"/>
  <line x1="280" y1="120" x2="280" y2="350" stroke="#c9925a" stroke-width="6"/>
  <line x1="320" y1="120" x2="320" y2="350" stroke="#c9925a" stroke-width="6"/>
  <line x1="360" y1="120" x2="360" y2="350" stroke="#c9925a" stroke-width="6"/>
  <circle cx="250" cy="270" r="45" fill="none" stroke="#c9925a" stroke-width="6"/>
  <circle cx="180" cy="300" r="26" fill="#c98a4a"/>
  <circle cx="164" cy="288" r="8" fill="#c98a4a"/>
  <circle cx="196" cy="288" r="8" fill="#c98a4a"/>
  <circle cx="174" cy="302" r="3" fill="#3a2313"/>
  <circle cx="186" cy="302" r="3" fill="#3a2313"/>
</svg>`,

  'sneaker.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">
  <rect width="500" height="500" fill="#f2f2f2"/>
  <path d="M90 320 q0 -40 40 -50 l80 -20 q20 -30 60 -30 q40 0 70 30 l70 20 q40 10 40 50 v20 h-360 z" fill="#e25555"/>
  <path d="M90 320 h360 v20 h-360 z" fill="#2b2f38"/>
  <path d="M210 220 q20 -20 50 -10 l60 20" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
</svg>`,

  'boarding-pass.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="640" viewBox="0 0 500 640">
  <rect width="500" height="640" fill="#eef3fb"/>
  <rect x="60" y="80" width="380" height="200" rx="14" fill="#ffffff" stroke="#c7d2e3" stroke-width="3"/>
  <text x="90" y="140" font-family="Verdana, sans-serif" font-size="26" font-weight="700" fill="#1f2d4a">BOARDING PASS</text>
  <text x="90" y="180" font-family="Verdana, sans-serif" font-size="16" fill="#5c6b85">BLR -&gt; DEL   Booking BX4471</text>
  <text x="90" y="210" font-family="Verdana, sans-serif" font-size="16" fill="#5c6b85">Gate 14   Seat 22C</text>
  <path d="M330 90 l60 45 l-60 45 l15 -45 z" fill="#3d67c9"/>
  <line x1="60" y1="320" x2="440" y2="320" stroke="#c7d2e3" stroke-width="2" stroke-dasharray="8,8"/>
  <rect x="90" y="350" width="320" height="60" fill="#1f2d4a"/>
</svg>`,

  'app-preview.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="480" viewBox="0 0 500 480">
  <rect width="500" height="480" fill="#0e2521"/>
  <rect x="160" y="40" width="180" height="380" rx="26" fill="#132f29" stroke="#3fa88a" stroke-width="4"/>
  <rect x="178" y="70" width="144" height="300" rx="10" fill="#0a1b17"/>
  <path d="M220 220 a24 24 0 0 1 6-46 a32 32 0 0 1 61 6 a21 21 0 0 1 -3 40 z" fill="#3fa88a"/>
  <text x="250" y="330" font-family="sans-serif" font-size="16" fill="#8fd9c4" text-anchor="middle">Haven</text>
</svg>`,

  'grocery-flyer.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#eef8ec"/>
  <text x="40" y="60" font-family="Verdana, sans-serif" font-size="28" font-weight="700" fill="#2f7a3d">This Week's Deals</text>
  <circle cx="90" cy="150" r="40" fill="#e2574c"/>
  <circle cx="200" cy="150" r="40" fill="#f2b544"/>
  <circle cx="310" cy="150" r="40" fill="#5aa85a"/>
  <rect x="380" y="120" width="70" height="60" rx="8" fill="#7a4a2b"/>
  <text x="40" y="260" font-family="sans-serif" font-size="16" fill="#3d5a3f">Fresh picks - weekly deals - recipe ideas</text>
</svg>`,

  'camera-reference.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="480" viewBox="0 0 500 480">
  <rect width="500" height="480" fill="#fdf6ec"/>
  <rect x="130" y="150" width="240" height="160" rx="14" fill="#3a3a3a"/>
  <rect x="200" y="120" width="100" height="40" rx="8" fill="#3a3a3a"/>
  <circle cx="250" cy="230" r="55" fill="#616161"/>
  <circle cx="250" cy="230" r="36" fill="#9aa0a6"/>
  <circle cx="335" cy="175" r="8" fill="#f2b544"/>
</svg>`,

  'personal-photo.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400" viewBox="0 0 500 400">
  <rect width="500" height="400" fill="#2a2438"/>
  <circle cx="120" cy="90" r="80" fill="#4a3f63" opacity="0.6"/>
  <circle cx="420" cy="300" r="110" fill="#5b4f7a" opacity="0.5"/>
  <circle cx="180" cy="250" r="55" fill="#e8c9a0"/>
  <circle cx="300" cy="240" r="55" fill="#d8a878"/>
  <rect x="0" y="330" width="500" height="70" fill="#1a1626" opacity="0.7"/>
</svg>`,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [file, svg] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT_DIR, file), svg);
}

console.log(`Generated ${Object.keys(files).length} attachment illustrations in ${OUT_DIR}`);
