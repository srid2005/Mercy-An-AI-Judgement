const path = require("path");
module.exports = {
  plugins: {
    // explicit path: the dev server may be launched from the repo root
    tailwindcss: { config: path.join(__dirname, "tailwind.config.js") },
    autoprefixer: {},
  },
};
