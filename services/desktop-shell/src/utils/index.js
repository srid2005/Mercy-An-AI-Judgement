import icons from "./apps";

// Fixed layout. win11React let the user rearrange and cached it in
// localStorage; an evidence image should look the same for every participant.
var { taskbar, desktop, pinned, recent } = {
  taskbar: ["File Explorer", "Orbit", "Quill"],
  desktop: ["Meera", "Recycle Bin", "File Explorer", "Orbit", "Quill", "Notepad", "Photos", "PulseFit"],
  pinned: ["Orbit", "Quill", "File Explorer", "Notepad", "PulseFit", "Photos", "Settings"],
  recent: ["Quill", "Orbit", "Notepad"],
};

export const taskApps = icons.filter((x) => taskbar.includes(x.name));

export const desktopApps = icons
  .filter((x) => desktop.includes(x.name))
  .sort((a, b) => {
    return desktop.indexOf(a.name) > desktop.indexOf(b.name) ? 1 : -1;
  });

export const pinnedApps = icons
  .filter((x) => pinned.includes(x.name))
  .sort((a, b) => {
    return pinned.indexOf(a.name) > pinned.indexOf(b.name) ? 1 : -1;
  });

export const recentApps = icons
  .filter((x) => recent.includes(x.name))
  .sort((a, b) => {
    return recent.indexOf(a.name) > recent.indexOf(b.name) ? 1 : -1;
  });

export const allApps = icons.filter((app) => {
  return app.type === "app";
});

export const dfApps = {
  taskbar,
  desktop,
  pinned,
  recent,
};
