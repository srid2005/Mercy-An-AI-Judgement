// Generates simple SVG placeholder images for every image_url referenced in
// db/init.sql. Run with `npm run gen:images`. Replace any file in
// public/images/** with an AI-generated image of the same name once ready --
// no other code needs to change.
const fs = require('fs');
const path = require('path');

const POSTS_DIR = path.join(__dirname, '..', 'public', 'images', 'posts');
const AVATARS_DIR = path.join(__dirname, '..', 'public', 'images', 'avatars');

const posts = [
  { file: 'family-dad-1.svg', title: 'FAMILY PHOTO', subtitle: 'Meera & her father, Sunday breakfast' },
  { file: 'family-dad-2.svg', title: 'FAMILY PHOTO', subtitle: 'Meera & her father, bike lesson' },
  { file: 'dog-1.svg', title: 'DOG PHOTO', subtitle: 'Bruno as a puppy' },
  { file: 'dog-2.svg', title: 'DOG PHOTO', subtitle: 'Bruno, 4th birthday' },
  { file: 'dog-3.svg', title: 'DOG PHOTO', subtitle: 'Bruno on an evening walk' },
  { file: 'cave-1.svg', title: 'CHILDHOOD PHOTO', subtitle: '"Our secret kingdom" -- the cave' },
  { file: 'cave-2.svg', title: 'CHILDHOOD PHOTO', subtitle: 'Hide-and-seek at the cave' },
  { file: 'college-1.svg', title: 'COLLEGE PHOTO', subtitle: 'Group project, Meera / Rahul / Priya / Nikhil' },
  { file: 'college-2.svg', title: 'COLLEGE PHOTO', subtitle: 'Last day of college' },
  { file: 'reunion.svg', title: 'REUNION PHOTO', subtitle: 'Meera & Rahul at the school reunion' },
  { file: 'tagged-forever.svg', title: 'REUNION PHOTO', subtitle: 'Meera & Rahul, day 2' },
  { file: 'wedding.svg', title: 'WEDDING PHOTO', subtitle: 'Meera & Arjun' },
  { file: 'rahul-trek.svg', title: 'LIFESTYLE PHOTO', subtitle: "Rahul's trek day" },
  { file: 'nikhil-desk.svg', title: 'LIFESTYLE PHOTO', subtitle: "Nikhil's new desk" },
  { file: 'priya-brunch.svg', title: 'LIFESTYLE PHOTO', subtitle: "Priya's Sunday brunch" },
  { file: 'arjun-datenight.svg', title: 'LIFESTYLE PHOTO', subtitle: 'Arjun & Meera, date night' },
  { file: 'rahul-monday.svg', title: 'LIFESTYLE PHOTO', subtitle: "Rahul's Monday coffee" },
  { file: 'ad-shoes.svg', title: 'SPONSORED', subtitle: 'urbansole.in -- new drop' },
  { file: 'ad-coffee.svg', title: 'SPONSORED', subtitle: 'brewhouse.coffee -- delivery ad' },
  { file: 'meme-1.svg', title: 'MEME', subtitle: 'daily.memez' },
  { file: 'meme-2.svg', title: 'MEME', subtitle: 'daily.memez' },
];

const avatars = [
  { file: 'meera.svg', label: 'meera' },
  { file: 'rahul.svg', label: 'rahul' },
  { file: 'nikhil.svg', label: 'nikhil' },
  { file: 'priya.svg', label: 'priya' },
  { file: 'arjun.svg', label: 'arjun' },
  { file: 'ravi_sharma.svg', label: 'ravi_sharma' },
  { file: 'blr.foodscene.svg', label: 'blr.foodscene' },
  { file: 'trail.diaries.svg', label: 'trail.diaries' },
  { file: 'citypaws.rescue.svg', label: 'citypaws.rescue' },
  { file: 'urbansole.in.svg', label: 'urbansole.in' },
  { file: 'daily.memez.svg', label: 'daily.memez' },
  { file: 'brewhouse.coffee.svg', label: 'brewhouse.coffee' },
  { file: 'kavya.raje29.svg', label: 'kavya.raje29' },
  { file: 'stylehub.deals.svg', label: 'stylehub.deals' },
  { file: 'vikram.svg', label: 'vikram' },
];

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function postSvg({ file, title, subtitle }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
  <rect width="640" height="420" fill="#22262f"/>
  <rect x="8" y="8" width="624" height="404" fill="none" stroke="#3a3f4a" stroke-width="2" stroke-dasharray="10,6"/>
  <text x="320" y="196" font-family="sans-serif" font-size="20" fill="#9aa0a6" text-anchor="middle">PLACEHOLDER IMAGE</text>
  <text x="320" y="226" font-family="sans-serif" font-size="15" fill="#c7cad0" text-anchor="middle">${esc(title)}</text>
  <text x="320" y="252" font-family="sans-serif" font-size="12" fill="#6b7280" text-anchor="middle">${esc(subtitle)}</text>
  <text x="320" y="392" font-family="ui-monospace,monospace" font-size="11" fill="#4b5563" text-anchor="middle">replace: images/posts/${esc(file)}</text>
</svg>`;
}

function avatarSvg({ file, label }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#2c313c"/>
  <circle cx="100" cy="78" r="34" fill="#4b5563"/>
  <rect x="46" y="118" width="108" height="64" rx="32" fill="#4b5563"/>
  <text x="100" y="192" font-family="sans-serif" font-size="12" fill="#9aa0a6" text-anchor="middle">${esc(label)}</text>
</svg>`;
}

fs.mkdirSync(POSTS_DIR, { recursive: true });
fs.mkdirSync(AVATARS_DIR, { recursive: true });

for (const p of posts) {
  fs.writeFileSync(path.join(POSTS_DIR, p.file), postSvg(p));
}
for (const a of avatars) {
  fs.writeFileSync(path.join(AVATARS_DIR, a.file), avatarSvg(a));
}

console.log(`Generated ${posts.length} post placeholders and ${avatars.length} avatar placeholders.`);
