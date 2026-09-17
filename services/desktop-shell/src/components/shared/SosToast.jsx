// The PulseFit alert waiting on the laptop when the participant unlocks it.
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { SOS } from "../../utils/sos";

export const SosToast = () => {
  const wall = useSelector((state) => state.wallpaper);
  const dispatch = useDispatch();
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(sessionStorage.getItem("sos-toast") === "seen");

  useEffect(() => {
    if (!wall.locked && wall.booted && !done) {
      const t = setTimeout(() => setShow(true), 2500);
      return () => clearTimeout(t);
    }
  }, [wall.locked, wall.booted, done]);

  const close = () => {
    setShow(false);
    setDone(true);
    sessionStorage.setItem("sos-toast", "seen");
  };
  const open = () => {
    close();
    dispatch({ type: "PULSEFIT", payload: "full" });
  };

  if (!show) return null;
  return (
    <div className="sosToast">
      <div className="stHead">
        <img src="img/icon/pulsefit.png" alt="" />
        <span>PulseFit · 3 days ago</span>
        <span className="stClose" onClick={close}>
          ✕
        </span>
      </div>
      <div className="stTitle">SOS alert from Meera's band</div>
      <div className="stBody">
        SOS sent at {SOS.sosTime}. Last known location{" "}
        <span className="stCoords">
          {SOS.lat.toFixed(6)}, {SOS.lng.toFixed(6)}
        </span>{" "}
        (±{SOS.accuracy} m). Signal lost at {SOS.lostTime}.
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
