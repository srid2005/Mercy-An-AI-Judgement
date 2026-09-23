import React, { Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import store from "./reducers";
import { Provider } from "react-redux";

// The static loader in index.html covers the wait for this bundle. It comes
// down after the first commit, when the shell's own boot screen is on screen.
const LoaderDown = () => {
  useEffect(() => {
    const el = document.getElementById("app-loader");
    if (!el) return;
    el.dataset.done = "true";
    const t = setTimeout(() => el.remove(), 350);
    return () => clearTimeout(t);
  }, []);
  return null;
};

const root = createRoot(document.getElementById("root"));

root.render(
  <Suspense
    fallback={
      <div id="sus-fallback">
        <h1>Loading</h1>
      </div>
    }
  >
    <Provider store={store}>
      <App />
      <LoaderDown />
    </Provider>
  </Suspense>,
);
