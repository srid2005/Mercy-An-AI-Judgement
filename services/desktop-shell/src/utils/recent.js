// "Recent files" as Windows Explorer's Home shows them: the file, and the
// folder it lives in. The hidden folder is only findable from here (or by
// typing the path), which is the point.
const U = String.raw`C:\Users\Meera`;

export const RECENT = [
  { name: "IMG-20240811-WA0002.jpg", path: U + String.raw`\AppData\Local\.n`, when: "3 days ago" },
  { name: "IMG-20240719-WA0012.jpg", path: U + String.raw`\AppData\Local\.n`, when: "5 days ago" },
  { name: "notes.txt", path: U + String.raw`\Documents`, when: "6 days ago" },
  { name: "PulseFit-export-Aug.csv", path: U + String.raw`\Downloads`, when: "1 week ago" },
  { name: "Q2_review_notes.txt", path: U + String.raw`\Documents\Office`, when: "2 weeks ago" },
  { name: "IMG_20240817_203344.jpg", path: U + String.raw`\Pictures\Camera Roll`, when: "3 weeks ago" },
];
