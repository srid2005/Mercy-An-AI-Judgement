// Generates the Haven logo, Meera's avatar, and one poster (video thumbnail)
// per diary entry. Run with `npm run gen:images`. Replace any file with a
// real still from the recording -- same name, nothing else changes.
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public', 'images');
const POSTERS = path.join(PUBLIC, 'posters');
const AVATARS = path.join(PUBLIC, 'avatars');

// Must match the recorded dates in db/init.sql (one poster per entry).
const ENTRIES = [
  ['2018-11-02', 'heavy'], ['2018-11-20', 'tired'], ['2019-03-14', 'happy'], ['2019-07-20', 'calm'],
  ['2019-10-14', 'heavy'], ['2020-06-05', 'tired'], ['2020-08-17', 'happy'], ['2021-02-15', 'happy'],
  ['2022-01-09', 'tired'], ['2022-08-09', 'calm'], ['2023-05-07', 'reflective'], ['2023-11-11', 'tired'],
  ['2024-03-22', 'anxious'], ['2024-04-30', 'calm'], ['2024-05-16', 'calm'], ['2024-06-21', 'anxious'],
  ['2024-07-01', 'anxious'], ['2024-07-19', 'anxious'], ['2024-08-02', 'heavy'], ['2024-08-06', 'calm'],
  ['2024-08-10', 'anxious'], ['2024-08-14', 'anxious'], ['2024-08-17', 'anxious'], ['2024-08-19', 'calm'],
  ['2024-08-21', 'afraid'], ['2024-08-23', 'anxious'], ['2024-08-25', 'afraid'], ['2024-08-28', 'afraid'],
  ['2024-08-30', 'anxious'], ['2024-09-01', 'reflective'], ['2024-09-02', 'afraid'],
];

// Poster tint follows the entry's mood, so the grid reads at a glance the
// way a real thumbnail strip would (warm early on, colder toward the end).
const TINT = {
  happy: ['#3d6b4f', '#8fd9c4'],
  calm: ['#2f5d55', '#7fc9b6'],
  tired: ['#3a4a4c', '#8fa8a6'],
  heavy: ['#2b2f3a', '#6f7a8f'],
  reflective: ['#3a3554', '#9a8fc4'],
  anxious: ['#3f3a30', '#b39a6a'],
  afraid: ['#3a2323', '#a05a5a'],
};

function posterSvg(date, mood) {
  const [c0, c1] = TINT[mood] || TINT.calm;
  const pretty = new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c0}"/>
      <stop offset="1" stop-color="${c1}"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <circle cx="320" cy="150" r="46" fill="#000" opacity="0.18"/>
  <circle cx="320" cy="150" r="42" fill="#e9d5bf"/>
  <rect x="246" y="205" width="148" height="110" rx="60" fill="#e9d5bf" opacity="0.9"/>
  <rect x="0" y="300" width="640" height="60" fill="#000" opacity="0.28"/>
  <circle cx="30" cy="30" r="7" fill="#e5484d"/>
  <text x="46" y="35" font-family="sans-serif" font-size="14" fill="#fff" opacity="0.9">REC</text>
  <text x="24" y="338" font-family="sans-serif" font-size="18" fill="#fff">${pretty}</text>
  <text x="616" y="338" font-family="sans-serif" font-size="13" fill="#fff" opacity="0.75" text-anchor="end">sample -- replace with real still</text>
</svg>`;
}

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" rx="40" fill="#132621"/>
  <path d="M60 120 a30 30 0 0 1 8-58 a40 40 0 0 1 76 8 a26 26 0 0 1 -4 50 z" fill="#3fa88a"/>
  <text x="100" y="170" font-family="sans-serif" font-size="16" fill="#8fd9c4" text-anchor="middle">Haven</text>
</svg>`;

const meeraSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#2c313c"/>
  <circle cx="100" cy="78" r="34" fill="#4b5563"/>
  <rect x="46" y="118" width="108" height="64" rx="32" fill="#4b5563"/>
  <text x="100" y="192" font-family="sans-serif" font-size="12" fill="#9aa0a6" text-anchor="middle">meera</text>
</svg>`;

fs.mkdirSync(POSTERS, { recursive: true });
fs.mkdirSync(AVATARS, { recursive: true });

for (const [date, mood] of ENTRIES) fs.writeFileSync(path.join(POSTERS, `${date}.svg`), posterSvg(date, mood));
// the real logo now lives at public/images/haven-logo.png; the SVG placeholder is no longer written
fs.writeFileSync(path.join(AVATARS, 'meera.svg'), meeraSvg);

console.log(`Generated ${ENTRIES.length} posters, 1 logo, 1 avatar.`);
