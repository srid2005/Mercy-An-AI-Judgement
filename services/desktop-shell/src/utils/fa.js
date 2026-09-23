// The FontAwesome icons the shell actually draws, by the name Icon's `fafa`
// prop uses. Icon used to do `import * as` on both packages and index them by
// string, which defeats tree-shaking: the whole solid set (~1 MB raw) shipped
// in the bundle for eighteen glyphs. Add a name here when a new fafa= appears.
import {
  faArrowLeft,
  faArrowRight,
  faArrowUp,
  faChartLine,
  faCheck,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faChevronUp,
  faCircle,
  faClockRotateLeft,
  faFilm,
  faHome,
  faKey,
  faMagnifyingGlass,
  faRedo,
  faStar,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { faClock as faClockReg, faNewspaper as faNewspaperReg, faStar as faStarReg } from "@fortawesome/free-regular-svg-icons";

export const FaIcons = {
  faArrowLeft,
  faArrowRight,
  faArrowUp,
  faChartLine,
  faCheck,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faChevronUp,
  faCircle,
  faClockRotateLeft,
  faFilm,
  faHome,
  faKey,
  faMagnifyingGlass,
  faRedo,
  faStar,
  faTimes,
};

export const FaRegIcons = {
  faClock: faClockReg,
  faNewspaper: faNewspaperReg,
  faStar: faStarReg,
};
