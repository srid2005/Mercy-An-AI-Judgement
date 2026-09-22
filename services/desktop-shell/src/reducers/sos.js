// SOS trail state. `released` comes from the console (mercy:gates, set when the
// engine's the_confession checkpoint has fired) or from demo mode when the shell
// runs standalone; `shown` is the list of alert ids the toast queue has already
// surfaced, mirrored to sessionStorage so a reload inside one game does not
// replay the five toasts. Nothing SOS-related renders while released is false.
const SHOWN_KEY = "sos-shown-v2";

const readShown = () => {
  try {
    const raw = sessionStorage.getItem(SHOWN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    return [];
  }
};

const writeShown = (shown) => {
  try {
    sessionStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
  } catch (err) {}
};

const defState = {
  released: false,
  shown: readShown(),
};

const sosReducer = (state = defState, action) => {
  switch (action.type) {
    case "SOSGATES": {
      const gates = action.payload || {};
      return {
        ...state,
        released: !!gates.sos_released,
      };
    }
    case "SOSSHOWN": {
      const id = action.payload;
      if (!id || state.shown.includes(id)) return state;
      const shown = [...state.shown, id];
      writeShown(shown);
      return {
        ...state,
        shown,
      };
    }
    default:
      return state;
  }
};

export default sosReducer;
