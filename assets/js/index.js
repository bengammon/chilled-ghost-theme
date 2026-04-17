// JavaScript files are compiled and minified during the build process to the assets/built folder. See available scripts in the package.json file.

// Import CSS
import "../css/index.scss";

// Import JS
import menuOpen from "./menuOpen";
import tocBot from "./tocbot.min";
import initPostNumbers from "./postNumber";

menuOpen();
initPostNumbers();

tocbot.init({
    // Where to render the table of contents.
    tocSelector: '.gh-toc',
    // Where to grab the headings to build the table of contents.
    contentSelector: '.gh-content',
    // Which headings to grab inside of the contentSelector element.
    headingSelector: 'h1, h2, h3, h4',
    // To handle fixed headers with tocbot, just pass the header offsets
    // as options to tocbot.
    headingsOffset: 100,
    scrollSmoothOffset: -100,
    // Ensure correct positioning
    hasInnerContainers: true,
    // Enable the URL hash to update with the proper heading ID as
    // a user scrolls the page.
    enableUrlHashUpdateOnScroll: false
});