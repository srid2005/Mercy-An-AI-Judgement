var wps = localStorage.getItem("wps") || 0;

const walls = [
  // Meera's own desktop: her and her father, the photo the whole case is about
  "meera/img0.jpg",
  "default/img0.jpg",
  "dark/img0.jpg",
  "ThemeA/img0.jpg",
  "ThemeA/img1.jpg",
  "ThemeA/img2.jpg",
  "ThemeA/img3.jpg",
  "ThemeB/img0.jpg",
  "ThemeB/img1.jpg",
  "ThemeB/img2.jpg",
  "ThemeB/img3.jpg",
  "ThemeC/img0.jpg",
  "ThemeC/img1.jpg",
  "ThemeC/img2.jpg",
  "ThemeC/img3.jpg",
  "ThemeD/img0.jpg",
  "ThemeD/img1.jpg",
  "ThemeD/img2.jpg",
  "ThemeD/img3.jpg",
];

const themes = ["default", "dark", "ThemeA", "ThemeB", "ThemeD", "ThemeC"];

const defState = {
  themes: themes,
  wps: wps,
  src: walls[wps],
  locked: true, // every fresh load of the evidence image starts at the lock screen
  booted: false || import.meta.env.MODE == "development",
  act: "",
  dir: 0,
};

const wallReducer = (state = defState, action) => {
  switch (action.type) {
    case "WALLUNLOCK":
      return {
        ...state,
        locked: false,
        dir: 0,
      };
    case "WALLNEXT":
      var twps = (state.wps + 1) % walls.length;
      localStorage.setItem("wps", twps);
      return {
        ...state,
        wps: twps,
        src: walls[twps],
      };
    case "WALLALOCK":
      return {
        ...state,
        locked: true,
        dir: -1,
      };
    case "WALLBOOTED":
      return {
        ...state,
        booted: true,
        dir: 0,
        act: "",
      };
    case "WALLRESTART":
      return {
        ...state,
        booted: false,
        dir: -1,
        locked: true,
        act: "restart",
      };
    case "WALLSHUTDN":
      return {
        ...state,
        booted: false,
        dir: -1,
        locked: true,
        act: "shutdn",
      };
    case "WALLSET":
      var isIndex = !Number.isNaN(parseInt(action.payload)),
        wps = 0,
        src = "";

      if (isIndex) {
        wps = localStorage.getItem("wps");
        src = walls[wps] ? walls[wps] : walls[0];
      } else {
        const idx = walls.findIndex((item) => item === action.payload);
        localStorage.setItem("wps", idx);
        src = action.payload;
        wps = walls[idx];
      }

      return {
        ...state,
        wps: wps,
        src: src,
      };
    default:
      return state;
  }
};

export default wallReducer;
