import { activeView } from "./appState";
import { Brochure } from "./brochure/Brochure";
import { Editor } from "./editor/Editor";

/**
 * Two views over one tour: the editor authors it, the brochure prints and
 * shares it. `activeView` follows the author's choice, except that a
 * `#view&t=` share link is read-only (SPEC D2) and always opens the brochure.
 */
export function App() {
  return activeView.value === "brochure" ? <Brochure /> : <Editor />;
}
