import { createRoot } from "react-dom/client";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

// The public same-host router exposes only owner chat on port 3001. Keep its
// production bundle independent from the private lab/admin application graph.
if (import.meta.env.PROD && window.location.port === "3001") {
  void import("./pages/OwnerChat").then(({ default: OwnerChat }) => {
    root.render(<OwnerChat />);
  });
} else {
  void import("./App").then(({ default: App }) => {
    root.render(<App />);
  });
}
