// The smartwatch SOS trail. Near the cave, not on it: the map decides the truth.
// Mirrors the SW-01..SW-05 rows seeded in mercy-engine exactly; the laptop is
// only the UI for the band that synced to it. Nothing here is rendered until the
// console releases the trail (mercy:gates -> state.sos.released).
export const BAND = { device: "PulseFit Band 3", owner: "Meera", battery: 41, lostTime: "02:16" };

export const SOS_ALERTS = [
  { n: 1, id: "SW-01", time: "22:41", nextDay: false, place: "St Aldric's Church", district: "Old Town", lat: 12.981491, lng: 77.510465, accuracy: 25, hr: 121, battery: 58 },
  { n: 2, id: "SW-02", time: "23:27", nextDay: false, place: "Auditorium", district: "Tech Quarter", lat: 13.016808, lng: 77.517941, accuracy: 40, hr: 141, battery: 54 },
  { n: 3, id: "SW-03", time: "00:19", nextDay: true, place: "Veterinary Hospital", district: "Garden Quarter", lat: 13.012707, lng: 77.486484, accuracy: 30, hr: 126, battery: 49 },
  { n: 4, id: "SW-04", time: "01:12", nextDay: true, place: "Eco-Park", district: "Westhollow", lat: 13.013302, lng: 77.463708, accuracy: 80, hr: 64, battery: 45 },
  { n: 5, id: "SW-05", time: "02:14", nextDay: true, place: "Kettle Hill, north face", district: "Kettle Hill hamlet", lat: 12.952185, lng: 77.503411, accuracy: 300, hr: 58, battery: 41, last: true },
];
