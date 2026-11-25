// Module registry. Each module: { id, icon, activate, deactivate, panel, onSun, onDate, onFloor, onPick }.
import sun from "./sun.js";
import plants from "./plants.js";
import wifi from "./wifi.js";
import homeassistant from "./homeassistant.js";
import solar from "./solar.js";
import cameras from "./cameras.js";
import furniture from "./furniture.js";
export const MODULES = [sun, plants, wifi, homeassistant, solar, cameras, furniture];
