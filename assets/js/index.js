// JavaScript files are compiled and minified during the build process to the assets/built folder. See available scripts in the package.json file.

// Import CSS
import "../css/index.scss";

// Import JS
import menuOpen from "./menuOpen";
import initToc from "./toc";
import initPostNumbers from "./postNumber";
import initTraining from "./training";
import "./subscribeCta";

menuOpen();
initPostNumbers();
initToc();
initTraining();
