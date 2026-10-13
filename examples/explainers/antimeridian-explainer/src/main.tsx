import { ExampleProvider } from "deck.gl-raster-examples-shared";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ExampleProvider>
      <App />
    </ExampleProvider>
  </StrictMode>,
);
