import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import Battery from "../../components/shared/Battery";
import { Icon, Image } from "../../utils/general";
import "./back.scss";

// The laptop PIN. The briefing tells the participant that Arjun knows it
// (their first date, 17/08). It is atmosphere, not a puzzle.
export const LAPTOP_PIN = "1708";

export const Background = () => {
  const wall = useSelector((state) => state.wallpaper);

  return (
    <div
      className="background"
      style={{
        backgroundImage: `url(img/wallpaper/${wall.src})`,
      }}
    ></div>
  );
};

const BOOT_LINES = ["Verifying image hash", "Mounting MEERA-LAPTOP.img", "Restoring cached sessions", "Isolating network", "Starting"];

export const BootScreen = (props) => {
  const dispatch = useDispatch();
  const wall = useSelector((state) => state.wallpaper);
  const [blackout, setBlackOut] = useState(false);
  const [line, setLine] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setLine((l) => Math.min(l + 1, BOOT_LINES.length - 1)), 900);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (props.dir < 0) {
      setTimeout(() => setBlackOut(true), 4000);
    }
  }, [props.dir]);

  useEffect(() => {
    if (props.dir < 0 && blackout && wall.act == "restart") {
      setTimeout(() => {
        setBlackOut(false);
        setTimeout(() => dispatch({ type: "WALLBOOTED" }), 4000);
      }, 2000);
    }
  }, [blackout]);

  return (
    <div className="bootscreen">
      <div className={blackout ? "hidden" : "flex flex-col items-center"}>
        <Image src="asset/bootlogo" w={360} />
        <div className="mt-24" id="loader">
          <svg className="progressRing" height={48} width={48} viewBox="0 0 16 16">
            <circle cx="8px" cy="8px" r="7px"></circle>
          </svg>
        </div>
        <div className="mt-6 text-xs text-gray-400 tracking-wide">{BOOT_LINES[line]}…</div>
      </div>
    </div>
  );
};

export const LockScreen = (props) => {
  const [lock, setLock] = useState(false);
  const [unlocked, setUnLock] = useState(false);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(0);
  const dispatch = useDispatch();
  const userName = useSelector((state) => state.setting.person.name);

  const splash = (e) => {
    if (e.target.dataset.action == "splash") setLock(true);
  };

  const proceed = () => {
    if (pin === LAPTOP_PIN) {
      setUnLock(true);
      setTimeout(() => dispatch({ type: "WALLUNLOCK" }), 1000);
    } else {
      setErr(err + 1);
      setPin("");
    }
  };

  const onKey = (e) => {
    if (e.key == "Enter") proceed();
  };

  useEffect(() => {
    if (lock) {
      const el = document.getElementById("lockpin");
      if (el) el.focus();
    }
  }, [lock]);

  const now = new Date();

  return (
    <div
      className={"lockscreen " + (props.dir == -1 ? "slowfadein" : "")}
      data-unlock={unlocked}
      style={{
        backgroundImage: `url(${`img/wallpaper/lock.jpg`})`,
      }}
      onClick={splash}
      data-action="splash"
      data-blur={lock}
    >
      <div className="splashScreen mt-40" data-faded={lock} data-action="splash">
        <div className="text-6xl font-semibold text-gray-100" data-action="splash">
          {now.toLocaleTimeString("en-US", { hour: "numeric", minute: "numeric", hour12: true })}
        </div>
        <div className="text-lg font-medium text-gray-200" data-action="splash">
          {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <div className="lockNotif" data-action="splash">
          <img src="img/icon/pulsefit.png" alt="" data-action="splash" />
          <div data-action="splash">
            <div className="lnTitle" data-action="splash">
              PulseFit · SOS alert
            </div>
            <div className="lnBody" data-action="splash">
              Meera's band sent an SOS. Signal lost. Unlock to view.
            </div>
          </div>
        </div>
      </div>
      <div className="fadeinScreen" data-faded={!lock} data-unlock={unlocked}>
        <Image className="rounded-full overflow-hidden" src="img/asset/prof.jpg" w={200} ext />
        <div className="mt-2 text-2xl font-medium text-gray-200">{userName}</div>
        <div className="flex items-center mt-6 pinRow">
          <input
            id="lockpin"
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={onKey}
            placeholder="PIN"
            autoComplete="off"
          />
          <Icon className="-ml-6 handcr" fafa="faArrowRight" width={14} color="rgba(170, 170, 170, 0.6)" onClick={proceed} />
        </div>
        {err > 0 ? <div className="text-xs text-red-200 mt-3">The PIN is incorrect. Try again.</div> : null}
        {err > 1 ? <div className="text-xs text-gray-400 mt-1">Hint: our first date (DDMM)</div> : null}
        <div className="text-xs text-gray-400 mt-6">MERCY sandbox · device MEERA-LAPTOP</div>
      </div>
      <div className="bottomInfo flex">
        <Icon className="mx-2" src="wifi" ui width={16} invert />
        <Battery invert />
      </div>
    </div>
  );
};
