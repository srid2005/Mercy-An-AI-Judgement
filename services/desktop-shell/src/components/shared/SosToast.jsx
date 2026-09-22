// The PulseFit alerts waiting on the laptop once the console has released the
// SOS trail (state.sos.released, set by mercy:gates after the_confession).
// Five toasts in story order, paced: the first 2.5 s after the desktop is
// unlocked, each next one 6 s after the previous closes; a toast auto-advances
// after 9 s or on Dismiss. Every alert surfaced is recorded with SOSSHOWN (the
// reducer mirrors it to sessionStorage) so a reload inside one game does not
// replay the queue. Nothing is reported as evidence from here -- the toast is a
// cue; PulseFit files SW-01..05 when the participant opens it.
import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { BAND, SOS_ALERTS } from "../../utils/sos";

const FIRST_DELAY = 2500;
const NEXT_DELAY = 6000;
const AUTO_ADVANCE = 9000;

export const SosToast = () => {
  const wall = useSelector((state) => state.wallpaper);
  const sos = useSelector((state) => state.sos);
  const dispatch = useDispatch();
  const [current, setCurrent] = useState(null);
  const closedOne = useRef(false);

  const next = SOS_ALERTS.find((a) => !sos.shown.includes(a.id)) || null;
  const ready = wall.booted && !wall.locked && sos.released;

  // schedule the next toast of the queue
  useEffect(() => {
    if (current || !ready || !next) return;
    const t = setTimeout(() => setCurrent(next), closedOne.current ? NEXT_DELAY : FIRST_DELAY);
    return () => clearTimeout(t);
  }, [current, ready, next && next.id]);

  // the desktop locked again with a toast up: take it down unseen (no SOSSHOWN),
  // it is rescheduled after the next unlock
  useEffect(() => {
    if (!ready && current) setCurrent(null);
  }, [ready]);

  const close = () => {
    if (!current) return;
    closedOne.current = true;
    dispatch({ type: "SOSSHOWN", payload: current.id });
    setCurrent(null);
  };
  const open = () => {
    close();
    dispatch({ type: "PULSEFIT", payload: "full" });
  };

  // auto-advance
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(close, AUTO_ADVANCE);
    return () => clearTimeout(t);
  }, [current && current.id]);

  if (!current) return null;
  const a = current;
  return (
    <div className="sosToast" key={a.id}>
      <div className="stHead">
        <img src="img/icon/pulsefit.png" alt="" />
        <span>PulseFit · last night</span>
        <span className="stClose" onClick={close}>
          ✕
        </span>
      </div>
      <div className="stTitle">
        SOS alert {a.n} of 5 · {a.time}
      </div>
      <div className="stBody">
        Meera's band, near {a.place}, {a.district}.{" "}
        <span className="stCoords">
          {a.lat.toFixed(6)}, {a.lng.toFixed(6)}
        </span>{" "}
        (±{a.accuracy} m). HR {a.hr} · battery {a.battery}%
        {a.last ? <> Signal lost at {BAND.lostTime}.</> : null}
      </div>
      <div className="stBtns">
        <div className="stBtn primary" onClick={open}>
          Open PulseFit
        </div>
        <div className="stBtn" onClick={close}>
          Dismiss
        </div>
      </div>
    </div>
  );
};
