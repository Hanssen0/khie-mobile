import "./src/runtime/polyfills";

import { registerRootComponent } from "expo";

import App from "./App";
import { registerKhieHeadlessTask } from "./src/khie/backgroundKeepAlive";

registerKhieHeadlessTask();
registerRootComponent(App);
