// Copies public/videos/sample.mp4 to one file per diary entry, named by
// recording date (matching video_url in db/init.sql). Never overwrites a
// file that already exists, so real recordings dropped in by name survive
// re-runs. Run with `npm run gen:videos`.
const fs = require('fs');
const path = require('path');

const VIDEOS = path.join(__dirname, '..', 'public', 'videos');
const SAMPLE = path.join(VIDEOS, 'sample.mp4');

const DATES = [
  '2018-11-02', '2018-11-20', '2019-03-14', '2019-07-20', '2019-10-14', '2020-06-05', '2020-08-17', '2021-02-15',
  '2022-01-09', '2022-08-09', '2023-05-07', '2023-11-11', '2024-03-22', '2024-04-30', '2024-05-16', '2024-06-21',
  '2024-07-01', '2024-07-19', '2024-08-02', '2024-08-06', '2024-08-10', '2024-08-14', '2024-08-17', '2024-08-19',
  '2024-08-21', '2024-08-23', '2024-08-25', '2024-08-28', '2024-08-30', '2024-09-01', '2024-09-02',
];

if (!fs.existsSync(SAMPLE)) {
  console.error(`Missing ${SAMPLE} -- see README for how it was generated.`);
  process.exit(1);
}

let copied = 0;
for (const date of DATES) {
  const target = path.join(VIDEOS, `${date}.mp4`);
  if (fs.existsSync(target)) continue;
  fs.copyFileSync(SAMPLE, target);
  copied += 1;
}
console.log(`Copied sample video to ${copied} new entry file(s); ${DATES.length - copied} already present.`);
