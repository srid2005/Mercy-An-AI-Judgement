import { useEffect } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useDispatch, useSelector } from "react-redux";
import "./index.css";

import ActMenu from "./components/menu";
import { BandPane, CalnWid, DesktopApp, SidePane, StartMenu } from "./components/start";
import Taskbar from "./components/taskbar";
import { SosToast } from "./components/shared/SosToast";
import { Background, BootScreen, LockScreen } from "./containers/background";

import { loadSettings } from "./actions";
import { useMercyContext } from "./utils/context";
import * as Applications from "./containers/applications";
import * as Drafts from "./containers/applications/draft";

function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div style={{ background: "#0067c0", color: "#fff", minHeight: "100vh", padding: "10vh 12vw", fontFamily: "Segoe UI, sans-serif" }}>
      <h1 style={{ fontSize: 96, margin: 0 }}>:(</h1>
      <h2 style={{ fontSize: 22, fontWeight: 400 }}>The evidence image ran into a problem and needs to restart.</h2>
      <p style={{ opacity: 0.8, fontSize: 13 }}>Stop code: {error.message}</p>
      <button onClick={resetErrorBoundary} style={{ marginTop: 20, padding: "8px 18px" }}>
        Restart
      </button>
    </div>
  );
}

function App() {
  const apps = useSelector((state) => state.apps);
  const wall = useSelector((state) => state.wallpaper);
  const dispatch = useDispatch();

  // tells the console's hint desk which screen of the laptop is showing
  useMercyContext();

  const afterMath = (event) => {
    var ess = [
      ["START", "STARTHID"],
      ["BAND", "BANDHIDE"],
      ["PANE", "PANEHIDE"],
      ["WIDG", "WIDGHIDE"],
      ["CALN", "CALNHIDE"],
      ["MENU", "MENUHIDE"],
    ];

    var actionType = "";
    try {
      actionType = event.target.dataset.action || "";
    } catch (err) {}

    var actionType0 = getComputedStyle(event.target).getPropertyValue("--prefix");

    ess.forEach((item, i) => {
      if (!actionType.startsWith(item[0]) && !actionType0.startsWith(item[0])) {
        dispatch({
          type: item[1],
        });
      }
    });
  };

  window.oncontextmenu = (e) => {
    afterMath(e);
    e.preventDefault();
    var data = {
      top: e.clientY,
      left: e.clientX,
    };

    if (e.target.dataset.menu != null) {
      data.menu = e.target.dataset.menu;
      data.attr = e.target.attributes;
      data.dataset = e.target.dataset;
      dispatch({
        type: "MENUSHOW",
        payload: data,
      });
    }
  };

  window.onclick = afterMath;

  window.onload = (e) => {
    dispatch({ type: "WALLBOOTED" });
  };

  useEffect(() => {
    if (!window.onstart) {
      loadSettings();
      window.onstart = setTimeout(() => {
        dispatch({ type: "WALLBOOTED" });
      }, 5000);
    }
  });

  // SOS gate bridge. Embedded in the console's laptop iframe: the console pushes
  // { type:'mercy:gates', gates:{ sos_released } } (on load, on every state
  // refresh) and answers our 'mercy:gates?' handshake, so whichever side comes
  // up first the flag lands. The check is on ev.source === window.parent, not a
  // hard-coded origin, because the shell is served from whatever hostname the
  // participant used. Standalone (no parent): demo mode, released unless ?sos=0.
  useEffect(() => {
    const embedded = window.self !== window.top;
    if (!embedded) {
      dispatch({ type: "SOSGATES", payload: { sos_released: new URLSearchParams(location.search).get("sos") !== "0" } });
    } else {
      const onMsg = (ev) => {
        if (ev.source !== window.parent || !ev.data || ev.data.type !== "mercy:gates") return;
        dispatch({ type: "SOSGATES", payload: ev.data.gates || {} });
      };
      window.addEventListener("message", onMsg);
      window.parent.postMessage({ type: "mercy:gates?" }, "*");
      return () => window.removeEventListener("message", onMsg);
    }
  }, []);

  // Belt and braces for the same problem overflow:clip solves: if anything
  // still scrolls a window container (focus inside an iframe), snap it back.
  useEffect(() => {
    const reset = (e) => {
      const t = e.target;
      if (t && t.classList && (t.classList.contains("desktop") || t.classList.contains("windowScreen") || t.classList.contains("siteFrame"))) {
        t.scrollTop = 0;
        t.scrollLeft = 0;
      }
    };
    document.addEventListener("scroll", reset, true);
    return () => document.removeEventListener("scroll", reset, true);
  }, []);

  return (
    <div className="App">
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        {!wall.booted ? <BootScreen dir={wall.dir} /> : null}
        {wall.locked ? <LockScreen dir={wall.dir} /> : null}
        <div className="appwrap">
          <Background />
          <div className="desktop" data-menu="desk">
            <DesktopApp />
            {Object.keys(Applications).map((key, idx) => {
              var WinApp = Applications[key];
              return <WinApp key={idx} />;
            })}
            {Object.keys(apps)
              .filter((x) => x != "hz")
              .map((key) => apps[key])
              .map((app, i) => {
                if (app.pwa) {
                  var WinApp = Drafts[app.data.type];
                  return <WinApp key={i} icon={app.icon} {...app.data} />;
                }
              })}
            <StartMenu />
            <BandPane />
            <SidePane />
            <CalnWid />
            <SosToast />
          </div>
          <Taskbar />
          <ActMenu />
        </div>
      </ErrorBoundary>
    </div>
  );
}

export default App;
