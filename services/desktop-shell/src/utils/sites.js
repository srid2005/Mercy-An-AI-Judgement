// Everything the Orbit browser knows about the web Meera lived in.
//
// The four real services are reached on their ports; the address bar shows
// the story's domains instead. Everything else on the internet is
// unreachable, because the laptop is being examined inside MERCY's sandbox --
// so a bank or a travel site opens the "offline" page, and a search shows the
// query without results. That still tells the participant what she looked for.
import { serviceUrl } from "./apps";

export const SITES = {
  loop: { domain: "loop.social", name: "Loop", url: serviceUrl(4001), icon: "loop" },
  quill: { domain: "quill.mail", name: "Quill Mail", url: serviceUrl(4002), icon: "quill" },
  wisp: { domain: "wisp.chat", name: "Wisp Web", url: serviceUrl(4003), icon: "wisp" },
  haven: { domain: "haven.cloud", name: "Haven", url: serviceUrl(4008), icon: "haven" },
};

// Sites that only exist as names. Opening them shows the offline page.
export const KNOWN_OFFLINE = {
  "primebank.in": { name: "Prime Bank NetBanking", icon: "primebank" },
  "wanderly.travel": { name: "Wanderly -- stays and trips", icon: "wanderly" },
  "pulsefit.fit": { name: "PulseFit Dashboard", icon: "pulsefit" },
  "sift.search": { name: "Sift", icon: "sift" },
  "ksp.karnataka.gov.in": { name: "Karnataka State Police", icon: "kspolice" },
};

export const BOOKMARKS = [
  { title: "Loop", site: "loop", path: "/" },
  { title: "Wisp Web", site: "wisp", path: "/" },
  { title: "Haven", site: "haven", path: "/" },
  { title: "Prime Bank", domain: "primebank.in", path: "/netbanking" },
  { title: "Wanderly", domain: "wanderly.travel", path: "/" },
  { title: "PulseFit", domain: "pulsefit.fit", path: "/dashboard" },
  { title: "KSP - RTI", domain: "ksp.karnataka.gov.in", path: "/rti-information" },
];

// Saved logins, as the browser's password manager would show them. Revealing
// one asks for the Windows PIN, exactly like a real browser.
export const PASSWORDS = [
  { domain: "quill.mail", user: "meera.kapoor@quill.mail", pass: "Arjun", saved: true, note: "" },
  { domain: "primebank.in", user: "meerak84", pass: "Bruno@2019", saved: true, note: "" },
  { domain: "wanderly.travel", user: "meera.kapoor@quill.mail", pass: "coorg!trip", saved: true, note: "" },
  { domain: "pulsefit.fit", user: "meera.kapoor@quill.mail", pass: "Bruno@2019", saved: true, note: "" },
  { domain: "haven.cloud", user: "meera.kapoor@quill.mail", pass: null, saved: false, note: "Removed 12 days ago" },
  { domain: "loop.social", user: "meera", pass: null, saved: false, note: "Never saved for this site" },
];

// Browsing history. Day 0 is the evening she was taken, which every service
// pins at yesterday 21:40 (their t() shift); the band's SOS came at 02:14
// the following morning, after the last entry here.
const T0 = new Date();
T0.setDate(T0.getDate() - 1);
T0.setHours(21, 40, 0, 0);
const at = (dayOffset, hh, mm) => {
  const d = new Date(T0);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return d;
};

// newest first
export const HISTORY = [
  { t: at(0, 21, 52), site: "haven", path: "/", title: "Haven -- New recording" },
  { t: at(0, 21, 31), site: "wisp", path: "/", title: "Wisp Web" },
  { t: at(0, 21, 12), site: "loop", path: "/#/messages", title: "Messages · Loop" },
  { t: at(-1, 23, 40), site: "loop", path: "/#/profile/rahul", title: "Rahul Nair (@rahul) · Loop" },
  { t: at(-1, 23, 22), site: "loop", path: "/#/profile/trail.diaries", title: "Trail Diaries (@trail.diaries) · Loop" },
  { t: at(-1, 23, 5), site: "loop", path: "/#/profile/rahul", title: "Rahul Nair (@rahul) · Loop" },
  { t: at(-1, 22, 50), domain: "sift.search", path: "/?q=trail+diaries+trekking+club+bengaluru+2018+batch", title: "trail diaries trekking club bengaluru 2018 batch -- Sift" },
  { t: at(-1, 22, 41), site: "haven", path: "/", title: "Haven -- My recordings" },
  { t: at(-1, 21, 58), site: "wisp", path: "/", title: "Wisp Web" },
  { t: at(-2, 20, 15), site: "quill", path: "/#/", title: "Inbox -- Quill" },
  { t: at(-2, 19, 44), domain: "sift.search", path: "/?q=turahalli+forest+gate+guard+register", title: "turahalli forest gate guard register -- Sift" },
  { t: at(-2, 19, 30), domain: "sift.search", path: "/?q=how+to+find+jogger+witness+statement+2018", title: "how to find jogger witness statement 2018 -- Sift" },
  { t: at(-3, 13, 10), site: "quill", path: "/#/", title: "Drafts -- Quill" },
  { t: at(-3, 12, 55), domain: "ksp.karnataka.gov.in", path: "/rti-information", title: "RTI Information -- Karnataka State Police" },
  { t: at(-3, 12, 40), domain: "sift.search", path: "/?q=request+copy+of+UDR+police+file+karnataka", title: "request copy of UDR police file karnataka -- Sift" },
  { t: at(-4, 21, 20), site: "loop", path: "/", title: "Loop" },
  { t: at(-5, 22, 5), site: "haven", path: "/", title: "Haven -- New recording" },
  { t: at(-6, 18, 30), domain: "wanderly.travel", path: "/stays/coorg", title: "Homestays in Coorg -- Wanderly" },
  { t: at(-6, 18, 12), domain: "primebank.in", path: "/netbanking", title: "Prime Bank NetBanking" },
  { t: at(-8, 20, 45), domain: "sift.search", path: "/?q=turahalli+sunset+rock+railing+2019", title: "turahalli sunset rock railing 2019 -- Sift" },
  { t: at(-9, 9, 15), domain: "pulsefit.fit", path: "/dashboard", title: "PulseFit Dashboard" },
  { t: at(-10, 22, 30), site: "haven", path: "/", title: "Haven -- Settings" },
  { t: at(-12, 21, 10), site: "loop", path: "/#/profile/rahul", title: "Rahul Nair (@rahul) · Loop" },
  { t: at(-13, 14, 0), domain: "sift.search", path: "/?q=post+mortem+contusion+upper+arm+grip+pattern", title: "post mortem contusion upper arm grip pattern -- Sift" },
  { t: at(-14, 11, 25), site: "quill", path: "/#/", title: "Inbox -- Quill" },
  { t: at(-16, 20, 5), domain: "sift.search", path: "/?q=turahalli+minor+forest+gate+timings", title: "turahalli minor forest gate timings -- Sift" },
  { t: at(-18, 19, 50), domain: "wanderly.travel", path: "/", title: "Wanderly -- stays and trips" },
  { t: at(-20, 21, 30), domain: "sift.search", path: "/?q=bisi+bele+bath+recipe", title: "bisi bele bath recipe -- Sift" },
  { t: at(-22, 13, 5), domain: "primebank.in", path: "/netbanking", title: "Prime Bank NetBanking" },
  { t: at(-24, 22, 15), site: "loop", path: "/", title: "Loop" },
];

export const fmtWhen = (d) => {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + ", " + time;
};
