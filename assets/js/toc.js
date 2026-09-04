// tocbot.min.js is a webpack IIFE bundle with no ES exports: importing it for
// its side effect is what puts tocbot on window.
import "./tocbot.min";

const DESKTOP = "(min-width: 1024px)";

export default function initToc() {
    const toc = document.querySelector(".js-toc");

    // Only posts tagged #toc render the shell, so there is nothing to build
    // anywhere else on the site.
    if (!toc || !window.tocbot) {
        return;
    }

    window.tocbot.init({
        // Where to render the table of contents.
        tocSelector: ".gh-toc",
        // Where to grab the headings to build the table of contents.
        contentSelector: ".js-toc-content",
        // Which headings to grab inside of the contentSelector element.
        headingSelector: "h2, h3, h4",
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

    // In the sidebar the contents are always visible; stacked above the post
    // on narrow screens they start collapsed so they do not bury the article.
    const desktop = window.matchMedia(DESKTOP);
    const sync = (event) => { toc.open = event.matches; };

    sync(desktop);
    desktop.addEventListener("change", sync);
}
