// Orbit -- Meera's browser. Real tabs: each keeps its own history stack, so
// opening a new tab does not touch what the last one was doing. The address
// bar shows story domains; the real services load in an iframe, and each of
// them posts its route to us so the address bar follows what's on screen.
import React, { useState, useEffect, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Icon, ToolBar, LazyComponent } from "../../../utils/general";
import { SITES, KNOWN_OFFLINE, BOOKMARKS, PASSWORDS, HISTORY, fmtWhen } from "../../../utils/sites";
import { LAPTOP_PIN } from "../../background";
import "./assets/orbit.scss";

let nextId = 1;
const mk = (e) => ({ ...e, id: nextId++ });

let nextTabId = 1;
const newTabState = () => ({ tabId: nextTabId++, stack: [mk({ kind: "internal", page: "newtab" })], idx: 0, livePath: null, liveTitle: "" });

const siteByDomain = (domain) => Object.keys(SITES).find((k) => SITES[k].domain === domain);
const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch (e) {
    return "";
  }
};

// Turn whatever was typed into a navigation entry.
const resolve = (raw) => {
  if (raw == null) return mk({ kind: "internal", page: "newtab" });
  if (typeof raw === "object") return mk(raw); // already an entry (file open from Explorer)
  let s = String(raw).trim();
  if (!s) return mk({ kind: "internal", page: "newtab" });
  if (s.startsWith("orbit://")) return mk({ kind: "internal", page: s.slice(8).replace(/\/$/, "") || "newtab" });
  if (s.startsWith("file://")) return mk({ kind: "file", name: s.split("/").pop(), path: s, src: "/files/missing" });
  const m = s.match(/^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(\/[^\s]*)?$/i);
  if (m) {
    const domain = m[1].toLowerCase();
    const path = m[2] || "/";
    const key = siteByDomain(domain);
    if (key) return mk({ kind: "site", site: key, path });
    return mk({ kind: "offline", domain, path, title: (KNOWN_OFFLINE[domain] || {}).name || domain });
  }
  // a search
  return mk({ kind: "offline", domain: "sift.search", path: "/?q=" + encodeURIComponent(s).replace(/%20/g, "+"), title: `${s} -- Sift`, query: s });
};

const entryFromHistory = (h) => (h.site ? { kind: "site", site: h.site, path: h.path } : { kind: "offline", domain: h.domain, path: h.path, title: h.title });

const displayUrl = (entry, livePath) => {
  if (!entry) return "";
  if (entry.kind === "internal") return `orbit://${entry.page}`;
  if (entry.kind === "file") return entry.path;
  if (entry.kind === "offline") return `https://${entry.domain}${entry.path === "/" ? "" : entry.path}`;
  const p = (livePath != null ? livePath : entry.path) || "/";
  const pretty = p
    .replace(/^\/index\.html/, "/")
    .replace(/\.html#\//, "/")
    .replace(/\.html$/, "")
    .replace(/^\/#\//, "/")
    .replace(/^\/#$/, "/");
  return `https://${SITES[entry.site].domain}${pretty === "/" ? "" : pretty}`;
};

const faviconOf = (entry) => {
  if (!entry) return "img/site/orbit.png";
  if (entry.kind === "site") return `img/site/${SITES[entry.site].icon}.png`;
  if (entry.kind === "offline") return `img/site/${(KNOWN_OFFLINE[entry.domain] || {}).icon || "sift"}.png`;
  return "img/site/orbit.png";
};

const titleOf = (entry, liveTitle) =>
  !entry
    ? "Orbit"
    : entry.kind === "internal"
      ? { newtab: "New tab", history: "History", passwords: "Passwords" }[entry.page] || "Orbit"
      : entry.kind === "file"
        ? entry.name
        : entry.kind === "offline"
          ? entry.title
          : liveTitle || SITES[entry.site].name;

// the site's current page, as reported by its route messages, written back
// into the history entry so reload/back/forward return to the same page
const settleStack = (t) => t.stack.map((e, i) => (i === t.idx && e.kind === "site" && t.livePath ? { ...e, path: t.livePath } : e));

// session history lives with the seeded one, newest first
let sessionHistory = [];

export const EdgeMenu = () => {
  const wnapp = useSelector((state) => state.apps.orbit);
  const dispatch = useDispatch();
  const [tabs, setTabs] = useState(() => [newTabState()]);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(null); // null = not typing
  const tab = tabs[active] || tabs[0];
  const entry = tab.stack[tab.idx];

  const go = useCallback(
    (raw, atIdx) => {
      const ti = atIdx != null ? atIdx : active;
      const e = resolve(raw);
      setTabs((ts) =>
        ts.map((t, i) => {
          if (i !== ti) return t;
          const stack = settleStack(t);
          return { ...t, stack: [...stack.slice(0, t.idx + 1), e], idx: t.idx + 1, livePath: null, liveTitle: "" };
        }),
      );
      setTyped(null);
      if (e.kind === "site" || e.kind === "offline") {
        sessionHistory.unshift({ t: new Date(), ...(e.kind === "site" ? { site: e.site } : { domain: e.domain }), path: e.path, title: e.title || (e.kind === "site" ? SITES[e.site].name : e.domain) });
      }
    },
    [active],
  );

  // opened from elsewhere (Explorer double-click, PulseFit "open in Orbit")
  useEffect(() => {
    if (wnapp.url) {
      go(wnapp.url);
      dispatch({ type: "EDGELINK" });
    }
  }, [wnapp.url]);

  // park the active tab's site where the shell-wide context reporter can see
  // it: the hint desk asks about Loop or Haven, which have no window of their
  // own, and this local tab state is the only place that knows.
  const siteKey = entry && entry.kind === "site" ? entry.site : null;
  useEffect(() => {
    dispatch({ type: "ORBITSITE", payload: siteKey });
  }, [siteKey]);

  // the active tab's site tells us where it is
  useEffect(() => {
    const onMsg = (ev) => {
      if (!ev.data || ev.data.type !== "mercy:route") return;
      const t = tabs[active];
      const en = t && t.stack[t.idx];
      if (!en || en.kind !== "site") return;
      if (ev.origin !== originOf(SITES[en.site].url)) return;
      setTabs((ts) => ts.map((tt, i) => (i === active ? { ...tt, livePath: ev.data.path || "/", liveTitle: ev.data.title || tt.liveTitle } : tt)));
      if (ev.data.title && sessionHistory[0] && sessionHistory[0].site === en.site) {
        sessionHistory[0].title = ev.data.title;
        sessionHistory[0].path = ev.data.path || "/";
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [tabs, active]);

  const back = () => {
    setTabs((ts) => ts.map((t, i) => (i === active && t.idx > 0 ? { ...t, stack: settleStack(t), idx: t.idx - 1, livePath: null, liveTitle: "" } : t)));
    setTyped(null);
  };
  const fwd = () => {
    setTabs((ts) => ts.map((t, i) => (i === active && t.idx < t.stack.length - 1 ? { ...t, stack: settleStack(t), idx: t.idx + 1, livePath: null, liveTitle: "" } : t)));
    setTyped(null);
  };
  const reload = () => {
    // reload the page the site is on now, not the one the entry started at
    setTabs((ts) => ts.map((t, i) => (i === active ? { ...t, stack: settleStack(t).map((e, j) => (j === t.idx ? { ...e, id: nextId++ } : e)), livePath: null } : t)));
  };

  const openNewTab = () => {
    setActive(tabs.length);
    setTabs((ts) => [...ts, newTabState()]);
  };
  const closeTab = (i, ev) => {
    if (ev) ev.stopPropagation();
    if (tabs.length <= 1) {
      dispatch({ type: wnapp.action, payload: "close" });
      return;
    }
    setTabs((ts) => ts.filter((_, j) => j !== i));
    setActive((a) => (i === a ? Math.max(0, a - 1) : i < a ? a - 1 : a));
  };

  const onKey = (e) => {
    if (e.key === "Enter") go(e.target.value);
    else if (e.key === "Escape") setTyped(null);
  };

  const title = titleOf(entry, tab.liveTitle);
  const frameSrc = entry.kind === "site" ? SITES[entry.site].url + (entry.path === "/" ? "/" : entry.path) : entry.kind === "file" ? entry.src : null;

  return (
    <div
      className="edgeBrowser floatTab dpShad"
      data-size={wnapp.size}
      data-max={wnapp.max}
      style={{
        ...(wnapp.size == "cstm" ? wnapp.dim : null),
        zIndex: wnapp.z,
      }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar app={wnapp.action} icon={wnapp.icon} size={wnapp.size} name="Orbit" float />
      <div className="windowScreen flex flex-col">
        <div className="overTool flex">
          <Icon src={wnapp.icon} width={14} margin="0 6px" />
          {tabs.map((t, i) => {
            const e = t.stack[t.idx];
            return (
              <div key={t.tabId} className={"btab prtclk" + (i === active ? " active" : "")} onClick={() => setActive(i)}>
                <img className="tabfav" src={faviconOf(e)} alt="" />
                <div className="tabtitle">{titleOf(e, t.liveTitle)}</div>
                <Icon fafa="faTimes" onClick={(ev) => closeTab(i, ev)} width={10} />
              </div>
            );
          })}
          <div className="newtabbtn prtclk" onClick={openNewTab} title="New tab">
            +
          </div>
        </div>
        <div className="restWindow flex-grow flex flex-col">
          <div className="addressBar w-full h-10 flex items-center">
            <Icon className={"edgenavicon" + (tab.idx == 0 ? " dimmed" : "")} src="left" onClick={back} width={14} ui margin="0 8px" />
            <Icon className={"edgenavicon" + (tab.idx >= tab.stack.length - 1 ? " dimmed" : "")} src="right" onClick={fwd} width={14} ui margin="0 8px" />
            <Icon fafa="faRedo" onClick={reload} width={14} margin="0 8px" />
            <Icon fafa="faHome" onClick={() => go("orbit://newtab")} width={18} margin="0 16px" />
            <div className="addCont relative flex items-center">
              <img className="addrfav" src={faviconOf(entry)} alt="" />
              <input
                className="w-full h-6 px-4"
                onKeyDown={onKey}
                onChange={(e) => setTyped(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={() => setTyped(null)}
                value={typed != null ? typed : displayUrl(entry, tab.livePath)}
                placeholder="Search or enter web address"
                type="text"
                spellCheck={false}
              />
              <Icon className="handcr" fafa="faStar" reg width={13} margin="0 10px" />
            </div>
            <Icon className="handcr" fafa="faClockRotateLeft" onClick={() => go("orbit://history")} width={14} margin="0 8px" title="History" />
            <Icon className="handcr" fafa="faKey" onClick={() => go("orbit://passwords")} width={14} margin="0 8px" title="Passwords" />
          </div>
          <div className="w-full bookbar py-2">
            <div className="flex">
              {BOOKMARKS.map((b, i) => (
                <div
                  key={i}
                  className="flex handcr items-center ml-2 mr-1 prtclk"
                  onClick={() => go(b.site ? { kind: "site", site: b.site, path: b.path } : `https://${b.domain}${b.path}`)}
                >
                  <img className="mr-1 bmfav" src={`img/site/${b.site ? SITES[b.site].icon : (KNOWN_OFFLINE[b.domain] || {}).icon || "sift"}.png`} alt="" />
                  <div className="text-xs">{b.title}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="siteFrame flex-grow overflow-hidden relative">
            {frameSrc && frameSrc !== "/files/missing" ? (
              <LazyComponent show={!wnapp.hide}>
                <iframe key={tab.tabId + "-" + entry.id} src={frameSrc} id="isite" frameBorder="0" className="w-full h-full" title="site"></iframe>
              </LazyComponent>
            ) : entry.kind === "internal" && entry.page === "history" ? (
              <HistoryPage go={go} />
            ) : entry.kind === "internal" && entry.page === "passwords" ? (
              <PasswordsPage />
            ) : entry.kind === "file" ? (
              <BrokenFile entry={entry} />
            ) : entry.kind === "offline" ? (
              <OfflinePage entry={entry} />
            ) : (
              <NewTab go={go} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const NewTab = ({ go }) => {
  const recent = [...sessionHistory, ...HISTORY].slice(0, 6);
  return (
    <div className="orbitPage newtab win11Scroll">
      <div className="orbitLogo">
        <img src="img/site/orbit.png" alt="" />
        <span>Orbit</span>
      </div>
      <div className="ntSearch" onClick={() => document.querySelector(".addCont input").focus()}>
        Search or enter web address
      </div>
      <div className="ntTiles">
        {BOOKMARKS.map((b, i) => (
          <div key={i} className="ntTile prtclk" onClick={() => go(b.site ? { kind: "site", site: b.site, path: b.path } : `https://${b.domain}${b.path}`)}>
            <img src={`img/site/${b.site ? SITES[b.site].icon : (KNOWN_OFFLINE[b.domain] || {}).icon || "sift"}.png`} alt="" />
            <span>{b.title}</span>
          </div>
        ))}
      </div>
      <div className="ntSection">Recently visited</div>
      <div className="ntRecent">
        {recent.map((h, i) => (
          <div key={i} className="ntRow prtclk" onClick={() => go(entryFromHistory(h))}>
            <img src={`img/site/${h.site ? SITES[h.site].icon : (KNOWN_OFFLINE[h.domain] || {}).icon || "sift"}.png`} alt="" />
            <span className="ntTitle">{h.title}</span>
            <span className="ntWhen">{fmtWhen(h.t)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const HistoryPage = ({ go }) => {
  const [q, setQ] = useState("");
  const all = [...sessionHistory, ...HISTORY].filter((h) => !q || (h.title + " " + (h.site ? SITES[h.site].domain : h.domain)).toLowerCase().includes(q.toLowerCase()));
  // group by day
  const groups = [];
  all.forEach((h) => {
    const key = h.t.toDateString();
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: fmtWhen(h.t).split(",")[0], items: [] };
      groups.push(g);
    }
    g.items.push(h);
  });
  return (
    <div className="orbitPage settingsLike win11Scroll">
      <div className="pageHead">
        <h2>History</h2>
        <input className="pgSearch" placeholder="Search history" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {groups.map((g) => (
        <div key={g.key} className="histGroup">
          <div className="histDay">{g.label}</div>
          {g.items.map((h, i) => (
            <div key={i} className="histRow prtclk" onClick={() => go(entryFromHistory(h))}>
              <span className="histTime">{h.t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
              <img src={`img/site/${h.site ? SITES[h.site].icon : (KNOWN_OFFLINE[h.domain] || {}).icon || "sift"}.png`} alt="" />
              <span className="histTitle">{h.title}</span>
              <span className="histUrl">{h.site ? SITES[h.site].domain : h.domain}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

const PasswordsPage = () => {
  const [ask, setAsk] = useState(null); // index being revealed
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const [shown, setShown] = useState({});
  const submit = () => {
    if (pin === LAPTOP_PIN) {
      setShown({ ...shown, [ask]: true });
      setAsk(null);
      setPin("");
      setErr(false);
    } else {
      setErr(true);
      setPin("");
    }
  };
  return (
    <div className="orbitPage settingsLike win11Scroll">
      <div className="pageHead">
        <h2>Passwords</h2>
        <div className="pgSub">Saved passwords are protected by your Windows PIN.</div>
      </div>
      <div className="pwList">
        {PASSWORDS.map((p, i) => (
          <div key={i} className="pwRow">
            <img src={`img/site/${(KNOWN_OFFLINE[p.domain] || {}).icon || (SITES[siteByDomain(p.domain)] || {}).icon || "sift"}.png`} alt="" />
            <div className="pwSite">
              <div className="pwDomain">{p.domain}</div>
              <div className="pwUser">{p.user}</div>
            </div>
            {p.saved ? (
              <>
                <div className="pwPass">{shown[i] ? p.pass : "••••••••••"}</div>
                <div className="pwBtn prtclk" onClick={() => (shown[i] ? setShown({ ...shown, [i]: false }) : setAsk(i))}>
                  {shown[i] ? "Hide" : "Show"}
                </div>
              </>
            ) : (
              <div className="pwNote">{p.note}</div>
            )}
          </div>
        ))}
      </div>
      {ask != null ? (
        <div className="pinModal">
          <div className="pinBox">
            <div className="pinTitle">Windows Security</div>
            <div className="pinSub">Orbit is trying to show a saved password. Enter your PIN to allow this.</div>
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="PIN"
            />
            {err ? <div className="pinErr">That PIN is incorrect.</div> : null}
            <div className="pinBtns">
              <div className="pwBtn prtclk" onClick={submit}>
                OK
              </div>
              <div
                className="pwBtn prtclk"
                onClick={() => {
                  setAsk(null);
                  setPin("");
                  setErr(false);
                }}
              >
                Cancel
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const OfflinePage = ({ entry }) => {
  const isSearch = entry.domain === "sift.search";
  return (
    <div className="orbitPage offline">
      {isSearch ? (
        <>
          <div className="siftBar">
            <img src="img/site/sift.png" alt="" />
            <div className="siftQ">{entry.query || decodeURIComponent((entry.path.split("q=")[1] || "").replace(/\+/g, " "))}</div>
          </div>
          <div className="offBody">
            <div className="offIcon">⚠</div>
            <h3>No internet connection</h3>
            <p>Sift could not run this search. This device is running inside an evidence sandbox: only cached services are reachable.</p>
          </div>
        </>
      ) : (
        <div className="offBody">
          <div className="offIcon">⚠</div>
          <h3>This site can't be reached</h3>
          <p>
            <b>{entry.domain}</b> could not be contacted. This device is running inside the MERCY evidence sandbox; outbound connections are blocked. Only the services cached on this laptop are available.
          </p>
          <div className="offCode">ERR_SANDBOX_BLOCKED</div>
        </div>
      )}
    </div>
  );
};

const BrokenFile = ({ entry }) => (
  <div className="orbitPage offline">
    <div className="offBody">
      <div className="offIcon">⚠</div>
      <h3>Failed to load PDF document</h3>
      <p>
        <b>{entry.name}</b> is not present in the evidence image. The file table lists it, but its blocks were not recovered.
      </p>
      <div className="offCode">ERR_FILE_NOT_RECOVERED</div>
    </div>
  </div>
);
