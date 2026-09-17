/** @type {import('tailwindcss').Config} */
const path = require("path");
// absolute, forward-slash globs so the dev server works from any cwd
// (the launcher runs it from the repo root) and on Windows
const here = __dirname.split(path.sep).join("/");
module.exports = {
  content: [here + "/src/**/*.{js,jsx,ts,tsx}", here + "/index.html"],
  theme: {
    extend: {},
  },
  plugins: [],
};
