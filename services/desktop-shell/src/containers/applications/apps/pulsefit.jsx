// PulseFit -- the smartwatch companion app. This is where the participant gets
// the SOS trail from Meera's band, in play: five alerts through the night, the
// coordinates of each, the movement log before the signal was lost. Nothing
// SOS-related is in the DOM until the console releases the trail
// (state.sos.released); once it is, every alert on screen is filed as evidence
// (SW-01..05) whenever the window is visible -- the photos.jsx pattern.
import React, { useEffect, useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { ToolBar } from "../../../utils/general";
import { BAND, SOS_ALERTS, sosMinute } from "../../../utils/sos";
import { reportEvidenceIds } from "../../../actions";
import "./assets/pulsefit.scss";

// the trail as the participant reads it: oldest alert first, the last fix at
// the bottom next to the signal-lost line
const TRAIL = [...SOS_ALERTS].sort((a, b) => sosMinute(a) - sosMinute(b));

// the trail ran across midnight: rows before it are dated yesterday, after it today
const dayLabel = (nextDay) => {
  const d = new Date();
  if (!nextDay) d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
};

// qualifiers the band attached to the poorer fixes
const FIX_NOTE = {
  "SW-04": "under trees",
  "SW-05": "degraded fix, no line of sight",
};

const LAST = SOS_ALERTS[SOS_ALERTS.length - 1];
const LOG = [
  ["21:40", "Home", "HR 71"],
  ["21:58", "Walking", "0.4 km · HR 124"],
  ["22:03", "In vehicle", "—"],
  ["22:41", "SOS", "Long-press SOS · near St Aldric's Church"],
  ["22:50", "In vehicle", "HR 122"],
  ["23:25", "Running", "40 s · HR 146"],
  ["23:27", "SOS", "Long-press SOS · near the Auditorium"],
  ["23:33", "In vehicle", "HR 130"],
  ["00:19", "SOS", "Long-press SOS · near the Veterinary Hospital"],
  ["00:36", "In vehicle", "HR 88, falling"],
  ["01:12", "SOS", "Long-press SOS · Eco-Park"],
  ["01:49", "In vehicle", "HR 60"],
  ["02:12", "Stationary", "HR 58"],
  ["02:14", "SOS", `Long-press SOS · ${LAST.place} (±${LAST.accuracy} m)`],
  ["02:15", "Voice memo", "0:41 · stored on band · upload pending"],
  [BAND.lostTime, "Signal lost", `Last fix ${LAST.lat.toFixed(6)}, ${LAST.lng.toFixed(6)} (±${LAST.accuracy} m) · battery ${BAND.battery}%`],
];

const rowClass = (what) => (what === "SOS" ? " sos" : what === "Signal lost" ? " lost" : what === "Voice memo" ? " memo" : "");

const coordText = (a) => `${a.lat.toFixed(6)}, ${a.lng.toFixed(6)}`;

// execCommand path: the event is served over plain HTTP, where
// navigator.clipboard does not exist. Must run inside the click itself.
const legacyCopy = (text) => {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;user-select:text";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (e) {}
  ta.remove();
  return ok;
};
const copyText = (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => legacyCopy(text),
    );
  }
  return Promise.resolve(legacyCopy(text));
};

// The console (window.top) owns the map tab: it switches to it and forwards
// this to the map, which fills its lat/lng fields and waits for the
// participant to launch. Same window.top channel the evidence emitter uses,
// same "*" target -- the shell does not know the console's hostname.
const sendToMap = (a) => {
  try {
    window.top.postMessage({ type: "mercy:coords", lat: a.lat, lng: a.lng, label: `SOS ${a.n} - ${a.time}` }, "*");
    return true;
  } catch (e) {
    return false;
  }
};

export const PulseFit = () => {
  const wnapp = useSelector((state) => state.apps.pulsefit);
  const sos = useSelector((state) => state.sos);
  const dispatch = useDispatch();
  // per-alert button feedback ("Copied" / "Sent to map"), gone after a moment
  const [fb, setFb] = useState({});
  const fbTimer = useRef({});
  const flash = (id, text) => {
    setFb((f) => ({ ...f, [id]: { text, n: ((f[id] && f[id].n) || 0) + 1 } }));   // n remounts the node, so the fade restarts
    clearTimeout(fbTimer.current[id]);
    fbTimer.current[id] = setTimeout(() => setFb((f) => ({ ...f, [id]: null })), 1800);
  };
  useEffect(() => () => Object.values(fbTimer.current).forEach(clearTimeout), []);
  const embedded = window.self !== window.top;

  const onCopy = (a) => copyText(coordText(a)).then((ok) => flash(a.id, ok ? "Copied" : "Select the numbers and press Ctrl+C"));
  const onSend = (a) => flash(a.id, embedded && sendToMap(a) ? "Sent to the map" : "Open the map from the console");

  // every alert on screen counts as seen -- the toast and the lock screen
  // report nothing, the participant has to open the app
  useEffect(() => {
    if (wnapp && !wnapp.hide && sos.released) reportEvidenceIds(TRAIL.map((a) => a.id));
  }, [wnapp && wnapp.hide, sos.released]);
  if (!wnapp) return null;

  return (
    <div
      className="pulsefit floatTab dpShad"
      data-size={wnapp.size}
      data-max={wnapp.max}
      style={{
        ...(wnapp.size == "cstm" ? wnapp.dim : null),
        zIndex: wnapp.z,
      }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar app={wnapp.action} icon={wnapp.icon} size={wnapp.size} name="PulseFit" />
      <div className="windowScreen flex flex-col" data-dock="true">
        <div className="restWindow flex-grow pfBody win11Scroll">
          <div className="pfHead">
            <div>
              <div className="pfDevice">{BAND.device}</div>
              <div className="pfOwner">Paired · {BAND.owner}'s band · battery {BAND.battery}% at last sync</div>
            </div>
            <div className="pfStatus lost">Disconnected</div>
          </div>

          {sos.released ? (
            <>
              <div className="pfSection">SOS trail · oldest first</div>
              {TRAIL.map((a) => (
                <div key={a.id} className={"pfSos" + (a.last ? " last" : "")}>
                  <div className="pfSosTitle">
                    <span className="pfDot" /> SOS alert
                    <span className="pfSosN">SOS {a.n}/5</span>
                  </div>
                  <div className="pfSosWhen">
                    {dayLabel(a.nextDay)}, {a.time}
                  </div>
                  <p>
                    Long-press SOS from the band, near {a.place}, {a.district}. Delivered to this laptop (paired device).
                  </p>
                  <div className="pfCoords">
                    <div className="pfFix">
                      <div className="pfLbl">Location at {a.time}</div>
                      <div className="pfVal">{coordText(a)}</div>
                      <div className="pfSub">
                        ±{a.accuracy} m{FIX_NOTE[a.id] ? ` · ${FIX_NOTE[a.id]}` : ""}
                      </div>
                    </div>
                    <div className="pfActs">
                      <div className="pfBtn prtclk" onClick={() => onCopy(a)}>
                        Copy
                      </div>
                      <div className="pfBtn primary prtclk" onClick={() => onSend(a)}>
                        Send to map
                      </div>
                    </div>
                    {fb[a.id] ? <div key={fb[a.id].n} className="pfFb">{fb[a.id].text}</div> : null}
                  </div>
                  <div className="pfMeta">
                    <span>HR {a.hr}</span>
                    <span>battery {a.battery}%</span>
                  </div>
                  {a.last ? (
                    <div className="pfAfter">
                      <p>02:15 Voice memo · 0:41 · stored on band · upload pending (no signal)</p>
                      <p>The band stopped reporting at {BAND.lostTime}.</p>
                    </div>
                  ) : null}
                </div>
              ))}

              <div className="pfSection">Activity log · last night</div>
              <div className="pfLog">
                {LOG.map((r, i) => (
                  <div key={i} className={"pfRow" + rowClass(r[1])}>
                    <span className="pfTime">{r[0]}</span>
                    <span className="pfWhat">{r[1]}</span>
                    <span className="pfDetail">{r[2]}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="pfQuiet">No alerts on this device.</div>
          )}

          <div className="pfSection">This week</div>
          <div className="pfStats">
            <div>
              <div className="pfVal">6,412</div>
              <div className="pfLbl">avg steps</div>
            </div>
            <div>
              <div className="pfVal">62</div>
              <div className="pfLbl">resting HR</div>
            </div>
            <div>
              <div className="pfVal">5h 40m</div>
              <div className="pfLbl">avg sleep</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
