// The apps on Meera's laptop. Loop, Wisp and Haven are deliberately NOT here:
// they are websites, reachable only through the Orbit browser (bookmarks,
// history, typed address). Quill is a proper desktop mail client.
export const gene_name = () =>
  Math.random().toString(36).substring(2, 10).toUpperCase();

// The four services run on their own ports; the shell is opened from the same
// host, so the participant's browser can reach them wherever the stack runs.
const host = window.location.hostname || "localhost";
export const serviceUrl = (port) => `http://${host}:${port}`;

const apps = [
  {
    name: "Start",
    icon: "home",
    type: "action",
    action: "STARTMENU",
  },
  {
    name: "Search",
    icon: "search",
    type: "action",
    action: "SEARCHMENU",
  },
  {
    name: "Settings",
    icon: "settings",
    type: "app",
    action: "SETTINGS",
  },
  {
    name: "File Explorer",
    icon: "explorer",
    type: "app",
    action: "EXPLORER",
  },
  {
    name: "Orbit",
    icon: "orbit",
    type: "app",
    action: "MSEDGE",
  },
  {
    name: "Quill",
    icon: "quill",
    type: "app",
    action: "QUILLMAIL",
    pwa: true,
    data: {
      type: "IFrame",
      url: serviceUrl(4002),
      invert: false,
    },
  },
  {
    name: "PulseFit",
    icon: "pulsefit",
    type: "app",
    action: "PULSEFIT",
  },
  {
    name: "Notes",
    icon: "notes",
    type: "app",
    action: "STICKY",
  },
  {
    name: "Notepad",
    icon: "notepad",
    type: "app",
    action: "NOTEPAD",
  },
  {
    name: "Recycle Bin",
    icon: "bin0",
    type: "app",
    action: "OPENBIN",
  },
  {
    name: "Meera",
    icon: "win/user",
    type: "app",
    action: "EXPLORER",
  },
  {
    name: "Photos",
    icon: "photos",
    type: "app",
    action: "PHOTOS",
  },
  {
    name: "Movies & TV",
    icon: "movies",
    type: "app",
    action: "MOVIES",
  },
];

export default apps;
