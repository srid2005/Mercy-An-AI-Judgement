// The MERCY notice shown once, when the image is first opened.
import React, { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";

export const AboutWin = () => {
  const { abOpen } = useSelector((state) => state.desktop);
  const { locked, booted } = useSelector((state) => state.wallpaper);
  const [open, setOpen] = useState(sessionStorage.getItem("mercy-notice") !== "seen");
  const [timer, setTimer] = useState(4);
  const dispatch = useDispatch();

  const action = () => {
    setOpen(false);
    sessionStorage.setItem("mercy-notice", "seen");
    dispatch({ type: "DESKABOUT", payload: false });
  };

  useEffect(() => {
    if (timer > 0 && !locked && booted) {
      const t = setTimeout(() => setTimer(timer - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [timer, locked, booted]);

  return open || abOpen ? (
    <div className="aboutApp floatTab dpShad">
      <div className="content p-6">
        <div className="text-xl font-semibold">MERCY · Evidence image mounted</div>
        <p className="mt-2">
          Device: <b>MEERA-LAPTOP</b> (personal laptop recovered from the residence of Meera Kapoor). Image verified. Clock, accounts and cached sessions are as found.
        </p>
        <p>You are working inside a sandbox. Outbound network is blocked; the services cached on this device remain reachable. Everything you open is logged to the case.</p>
        <p className="text-xs opacity-70 mt-2">Shell derived from win11React (CC0). Not affiliated with Microsoft.</p>
        <div className="okbtn handcr" data-allow={timer == 0} onClick={timer == 0 ? action : null}>
          {timer == 0 ? "Begin" : timer}
        </div>
      </div>
    </div>
  ) : null;
};
