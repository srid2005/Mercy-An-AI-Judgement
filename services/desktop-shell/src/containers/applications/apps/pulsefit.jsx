// PulseFit -- the smartwatch companion app. This is where the participant gets
// the last fix from Meera's band, in play: the SOS event, the coordinates, the
// movement log before the signal was lost.
import React from "react";
import { useSelector, useDispatch } from "react-redux";
import { ToolBar } from "../../../utils/general";
import { SOS } from "../../../utils/sos";
import "./assets/pulsefit.scss";


const dayLabel = () => {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
};

const LOG = [
  ["22:10", "Home", "Stationary · resting HR 64"],
  ["23:48", "Home", "Awake · HR 81"],
  ["00:31", "Home", "HR 96 · moving indoors"],
  ["01:37", "In vehicle", "24 min · 11.8 km"],
  ["02:01", "Walking", "Unpaved · 0.9 km · HR 118"],
  ["02:12", "Stationary", "HR 132"],
  ["02:14", "SOS", "Long-press SOS · sent to paired laptop"],
  ["02:16", "Signal lost", "Last fix 12.952185, 77.503411 (±300 m)"],
];

export const PulseFit = () => {
  const wnapp = useSelector((state) => state.apps.pulsefit);
  const dispatch = useDispatch();
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
              <div className="pfDevice">{SOS.device}</div>
              <div className="pfOwner">Paired · Meera's band · battery {SOS.battery}% at last sync</div>
            </div>
            <div className="pfStatus lost">Disconnected</div>
          </div>

          <div className="pfSos">
            <div className="pfSosTitle">
              <span className="pfDot" /> SOS alert
            </div>
            <div className="pfSosWhen">
              {dayLabel()}, {SOS.sosTime}
            </div>
            <p>Meera triggered SOS from the band. The alert was delivered to this laptop (paired device). The band stopped reporting at {SOS.lostTime}.</p>
            <div className="pfCoords">
              <div>
                <div className="pfLbl">Last known location</div>
                <div className="pfVal">
                  {SOS.lat.toFixed(6)}, {SOS.lng.toFixed(6)}
                </div>
                <div className="pfSub">accuracy ±{SOS.accuracy} m · GPS fix degraded (no line of sight)</div>
              </div>
              <div className="pfBtn prtclk" onClick={() => navigator.clipboard && navigator.clipboard.writeText(`${SOS.lat.toFixed(6)}, ${SOS.lng.toFixed(6)}`)}>
                Copy coordinates
              </div>
            </div>
          </div>

          <div className="pfSection">Activity log · night of the alert</div>
          <div className="pfLog">
            {LOG.map((r, i) => (
              <div key={i} className={"pfRow" + (r[1] === "SOS" ? " sos" : r[1] === "Signal lost" ? " lost" : "")}>
                <span className="pfTime">{r[0]}</span>
                <span className="pfWhat">{r[1]}</span>
                <span className="pfDetail">{r[2]}</span>
              </div>
            ))}
          </div>

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
