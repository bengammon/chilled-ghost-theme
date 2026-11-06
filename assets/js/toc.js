// tocbot.min.js is a webpack IIFE bundle with no ES exports: importing it for
// its side effect is what puts tocbot on window.
import "./tocbot.min";

// Matches $bp-post-margin in settings/_breakpoints.scss: from here the list
// sits open in the left margin rather than collapsed above the post.
const MARGIN = "(min-width: 1120px)";

/** Space kept above a heading when the list scrolls to it. */
const SCROLL_OFFSET = 24;

export default function initToc() {
    const toc = document.querySelector(".js-toc");
    const content = document.querySelector(".js-toc-content");

    // Only posts tagged #toc render the shell, so there is nothing to build
    // anywhere else on the site.
    if (!toc || !content || !window.tocbot) {
        return;
    }

    window.tocbot.init({
        // Where to render the table of contents.
        tocSelector: ".gh-toc",
        // Where to grab the headings to build the table of contents.
        contentSelector: ".js-toc-content",
        // Which headings to grab inside of the contentSelector element.
        headingSelector: "h2, h3, h4",
        // The header is not fixed, so the offsets only need a little air.
        headingsOffset: SCROLL_OFFSET,
        scrollSmoothOffset: -SCROLL_OFFSET,
        // Ensure correct positioning
        hasInnerContainers: true,
        // Enable the URL hash to update with the proper heading ID as
        // a user scrolls the page.
        enableUrlHashUpdateOnScroll: false
    });

    countSections(toc);

    // In the margin the contents are always visible; above the post on
    // narrow screens they start collapsed so they do not bury the article.
    const margin = window.matchMedia(MARGIN);
    const sync = (event) => { toc.open = event.matches; };

    sync(margin);
    margin.addEventListener("change", sync);

    trackProgress(toc, content);
}

/** "· 6 sections" in the collapsed summary, counting top-level entries. */
function countSections(toc) {
    const count = toc.querySelector(".js-toc-count");
    const sections = toc.querySelectorAll(".gh-toc > .toc-list > .toc-list-item").length;

    if (count && sections) {
        count.textContent = `· ${sections} ${sections === 1 ? "section" : "sections"}`;
    }
}

/**
 * Fills the rail as the reader moves through the post body, and counts the
 * reading time down to match. Progress runs from the body's top reaching the
 * top of the viewport to its bottom reaching the bottom of the viewport.
 */
function trackProgress(toc, content) {
    const bar = toc.querySelector(".js-toc-progress");
    const remaining = toc.querySelector(".js-toc-remaining");
    const total = parseInt(toc.dataset.readingMinutes, 10);

    if (!bar) {
        return;
    }

    let queued = false;

    const update = () => {
        queued = false;

        const rect = content.getBoundingClientRect();
        const travel = rect.height - window.innerHeight;
        const progress = travel > 0
            ? Math.min(1, Math.max(0, -rect.top / travel))
            : (rect.bottom <= window.innerHeight ? 1 : 0);

        bar.style.setProperty("--tocProgress", `${(progress * 100).toFixed(1)}%`);

        if (remaining && Number.isFinite(total)) {
            remaining.textContent = progress > 0.98
                ? "Finished"
                : `${Math.max(1, Math.round(total * (1 - progress)))} min left`;
        }
    };

    const queue = () => {
        if (!queued) {
            queued = true;
            window.requestAnimationFrame(update);
        }
    };

    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    update();
}
