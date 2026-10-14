import { Editor } from "./editor/Editor";

/**
 * The editor is the whole app for now. The brochure card (t_b8114d95) adds the
 * Editor ⇄ Brochure switch here — a `#view` share link should land straight in
 * the brochure, and the store's `readOnly` signal is the flag to branch on.
 */
export function App() {
  return <Editor />;
}
