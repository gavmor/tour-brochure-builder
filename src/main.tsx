import { render } from "preact";
import { App } from "./App";
import "leaflet/dist/leaflet.css";
import "./index.css";

render(<App />, document.getElementById("app")!);
