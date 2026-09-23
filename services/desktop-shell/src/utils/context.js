import { useEffect, useRef } from "react";
import { useSelector } from "react-redux";

// Where the participant is standing, reported to the MERCY console so a press
// of its Hint button answers THIS screen instead of the beat the engine last
// guessed at. Same window.top channel the evidence emitter uses (see
// reportEvidenceIds in actions/index.js) -- it reaches the console whether the
// shell is the Laptop tab or opened standalone.
//
// One subscriber, driven by redux, because redux is what the shell actually
// moves when a window opens, closes or comes forward. Reading the DOM would
// mean guessing at animation states the reducer already settled.

// The console and the engine share a fixed vocabulary of screen keys and app
// names. The reducer keys apps by icon, which is already the right word for
// every app but the explorer -- the hint chains call that one "files".
const APP_DETAIL = { explorer: "files" };

// Which window is on top: on screen (hide false), not minimised (max true),
// and holding the highest z the shell has handed out so far.
const focusedApp = (apps) => {
  var top = null;
  var keys = Object.keys(apps);

  for (var i = 0; i < keys.length; i++) {
    if (keys[i] == "hz") continue; // the z counter, not an app
    var app = apps[keys[i]];
    if (app.hide !== false || app.max !== true) continue;
    if (top == null || app.z > apps[top].z) top = keys[i];
  }

  return top;
};

const screenOf = (wall, apps) => {
  // App.jsx mounts BootScreen and LockScreen from separate flags, and a cold
  // start has both raised at once -- boot covers the lock screen until it
  // finishes, so it wins while it lasts.
  if (!wall.booted) return { screen: "laptop-boot" };
  if (wall.locked) return { screen: "laptop-lock" };

  var key = focusedApp(apps);
  if (key == null) return { screen: "laptop-desktop" };

  // Loop, Wisp and Haven are websites, not apps: reached only through Orbit.
  // A participant reading Wisp is "in Wisp" as far as the hint desk is
  // concerned, so the site outranks the browser hosting it.
  var site = key == "orbit" ? apps.orbit.site : null;

  return { screen: "laptop-app", detail: site || APP_DETAIL[key] || key };
};

export const useMercyContext = () => {
  const wall = useSelector((state) => state.wallpaper);
  const apps = useSelector((state) => state.apps);
  const last = useRef("");

  const { screen, detail } = screenOf(wall, apps);

  useEffect(() => {
    // The console keeps the latest and sends it with every hint request, so a
    // repeat of the same screen tells it nothing. Redux churns on every
    // keystroke in some apps; only post when the answer actually changed.
    const stamp = screen + "|" + (detail || "");
    if (last.current == stamp) return;
    last.current = stamp;

    try {
      const msg = { type: "mercy:context", screen };
      if (detail) msg.detail = detail;
      window.top.postMessage(msg, "*");
    } catch (e) {}
  }, [screen, detail]);
};
