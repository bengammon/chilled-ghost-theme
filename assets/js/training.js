/**
 * Training dashboard.
 *
 * Fetches /training.json and injects the stats panel and activity grid into the
 * mount point in partials/training-dashboard.hbs.
 *
 * The panel renders nothing on failure — no error state, no empty skeleton. A
 * training dashboard is not worth breaking a page over, so every exit path here
 * leaves the DOM alone.
 */

const ENDPOINT = '/training.json';
const TIMEOUT_MS = 4000;
const GRID_DAYS = 90;

/**
 * Fixed thresholds, so a colour represents the same amount of weight permanently.
 * Scaling against a rolling maximum was rejected: a new personal best would
 * retroactively re-shade every earlier day.
 *
 * Level 0 is reserved for days with no session at all. A logged session that moved
 * no external load — an ab wheel session, say — still reads as level 1, because it
 * happened and the grid should say so.
 */
function levelFor(kg) {
    if (kg < 2000) return 1;
    if (kg < 4000) return 2;
    if (kg < 6500) return 3;
    return 4;
}

export default function initTraining() {
    const mount = document.querySelector('[data-training]');

    if (!mount) {
        return;
    }

    // Locally there is no nginx and so no /training.json. Either hook points this
    // somewhere else: the data attribute for a template-level override, or
    // window.trainingDataUrl, which can be set from Ghost's code injection without
    // touching the repo at all. Same pattern as window.ghostContentApiKey.
    const endpoint = mount.dataset.trainingSrc || window.trainingDataUrl || ENDPOINT;

    load(endpoint).then((data) => {
        if (!data) {
            return;
        }
        render(mount, data);
    });
}

/**
 * The timeout matters as much as the catch — a hanging request is worse than a
 * failed one, because the page never settles.
 */
async function load(endpoint) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(endpoint, { signal: controller.signal });

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        // One shape check before anything touches the DOM.
        if (!data || !data.lifetime || !data.lifetime.tonnageKg || !Array.isArray(data.days)) {
            return null;
        }

        return data;
    } catch (err) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function render(mount, data) {
    mount.innerHTML = [
        renderPanel(data),
        renderMeta(data),
        renderMilestone(data.nextMilestone),
        renderGrid(data.days)
    ].join('');

    attachTooltip(mount);
    pinToCurrentWeek(mount);
}

function renderPanel(data) {
    const { lifetime, streak, comparison } = data;

    const comparisonLine = comparison
        ? `<p class="training__comparison">
               <span class="training__comparison-emoji" aria-hidden="true">${comparison.emoji}</span>
               about ${formatNumber(comparison.count)} ${escapeHtml(comparison.unit)}
           </p>`
        : '';

    const best = streak && streak.longestWeeks
        ? `<p class="training__stat-note">best ${streak.longestWeeks} ${pluralise(streak.longestWeeks, 'week')}</p>`
        : '';

    return `
        <div class="training__panel">
            <div class="training__hero">
                <p class="training__hero-value">
                    ${formatNumber(lifetime.tonnageKg)}<span class="training__hero-unit">kg</span>
                </p>
                <p class="training__hero-label">total weight moved</p>
                ${comparisonLine}
            </div>

            <div class="training__stat">
                <p class="training__stat-value">${streak ? streak.currentWeeks : 0}</p>
                <p class="training__stat-label">${pluralise(streak ? streak.currentWeeks : 0, 'week')} on the trot</p>
                ${best}
            </div>
        </div>
    `;
}

function renderMeta(data) {
    const { lifetime, last } = data;

    const items = [];

    if (last) {
        items.push(metaItem('Last session', relativeDay(last.date)));
    }
    items.push(metaItem('Sessions', formatNumber(lifetime.workouts)));
    items.push(metaItem('Reps', formatNumber(lifetime.reps)));

    if (lifetime.hours) {
        items.push(metaItem('Hours', formatNumber(lifetime.hours)));
    }

    return `<ul class="training__meta">${items.join('')}</ul>`;
}

function metaItem(label, value) {
    return `
        <li class="training__meta-item">
            <span class="training__meta-label">${label}</span>
            <span class="training__meta-value">${value}</span>
        </li>
    `;
}

function renderMilestone(milestone) {
    if (!milestone) {
        return '';
    }

    const pct = Math.max(0, Math.min(100, milestone.pctComplete));

    return `
        <div class="training__milestone">
            <div class="training__milestone-head">
                <span class="training__milestone-label">Next up: ${escapeHtml(milestone.label)}</span>
                <span class="training__milestone-remaining">${formatNumber(milestone.remaining)}${milestone.remainingUnit ? ` ${escapeHtml(milestone.remainingUnit)}` : ''} to go</span>
            </div>
            <div class="training__milestone-track" role="progressbar"
                 aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
                 aria-label="Progress to ${escapeHtml(milestone.label)}">
                <div class="training__milestone-bar" style="width: ${pct}%"></div>
            </div>
        </div>
    `;
}

/**
 * The grid is laid out as columns of weeks, Monday at the top, so it is built from
 * the Monday on or before the start of the window through to the end of this week.
 * Rest days are omitted from the data and filled in here.
 */
function renderGrid(days) {
    const byDate = new Map(days.map((day) => [day.date, day]));

    const today = startOfDay(new Date());
    const start = new Date(today);
    start.setDate(start.getDate() - (GRID_DAYS - 1));

    // Wind back to Monday so every column is a whole week.
    const cursor = new Date(start);
    cursor.setDate(cursor.getDate() - mondayOffset(cursor));

    const weeks = [];
    let week = [];
    let monthLabels = [];
    let lastMonth = null;

    while (cursor <= today) {
        if (week.length === 0) {
            // A column earns a month label when its first day opens a new month.
            const month = cursor.getMonth();
            if (month !== lastMonth) {
                monthLabels.push({ column: weeks.length, label: shortMonth(cursor) });
                lastMonth = month;
            } else {
                monthLabels.push(null);
            }
        }

        const iso = toIsoDate(cursor);
        const entry = byDate.get(iso);

        week.push(cellHtml(iso, entry, cursor > today || cursor < start));

        if (week.length === 7) {
            weeks.push(week);
            week = [];
        }
        cursor.setDate(cursor.getDate() + 1);
    }

    if (week.length > 0) {
        // Pad the final partial week so the column keeps its shape.
        while (week.length < 7) {
            week.push('<span class="training__day training__day--void" aria-hidden="true"></span>');
        }
        weeks.push(week);
    }

    const labelRow = monthLabels
        .map((entry) => `<span class="training__month">${entry ? entry.label : ''}</span>`)
        .join('');

    return `
        <div class="training__grid-wrap">
            <div class="training__grid-scroll">
                <div class="training__months" aria-hidden="true">${labelRow}</div>
                <div class="training__grid">
                    <div class="training__days" aria-hidden="true">
                        <span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span>
                    </div>
                    <div class="training__cells">${weeks.map((w) => w.join('')).join('')}</div>
                </div>
            </div>
            ${renderKey()}
        </div>
    `;
}

function cellHtml(iso, entry, outOfRange) {
    if (outOfRange) {
        return '<span class="training__day training__day--void" aria-hidden="true"></span>';
    }

    if (!entry) {
        return `<span class="training__day" data-level="0" aria-label="${longDate(iso)}, rest day"></span>`;
    }

    // The workout name is deliberately not surfaced: Hevy titles are days of the
    // week, so alongside the date it would only ever repeat what is already there.
    const level = levelFor(entry.kg);

    return `<span class="training__day" data-level="${level}"
                  data-kg="${formatNumber(entry.kg)}" data-date="${longDate(iso)}"
                  tabindex="0" aria-label="${longDate(iso)}, ${formatNumber(entry.kg)}kg"></span>`;
}

function renderKey() {
    const swatches = [0, 1, 2, 3, 4]
        .map((level) => `<span class="training__day" data-level="${level}"></span>`)
        .join('');

    return `
        <div class="training__key" aria-hidden="true">
            <span class="training__key-label">Less</span>
            ${swatches}
            <span class="training__key-label">More</span>
        </div>
    `;
}

/**
 * A single tooltip element, moved around on hover and focus.
 *
 * Deliberately not shown for touch: at nine pixels a per-day tooltip is too fiddly
 * to be worth it, and the grid is there to be scanned rather than interrogated. That
 * decision is made per event from `pointerType` rather than up front from a hover
 * media query — plenty of environments report no hover capability at all, and
 * gating on that loses the tooltip for mouse users too.
 */
function attachTooltip(mount) {
    const tip = document.createElement('div');
    tip.className = 'training__tip';
    tip.hidden = true;
    mount.appendChild(tip);

    const show = (event) => {
        // A touch or pen contact should not raise a tooltip; a mouse or the
        // keyboard (which reports no pointerType at all) should.
        if (event.pointerType && event.pointerType !== 'mouse') {
            return;
        }

        const cell = event.target.closest('[data-kg]');
        if (!cell) {
            return;
        }

        tip.textContent = `${cell.dataset.kg}kg — ${cell.dataset.date}`;
        tip.hidden = false;

        const cellBox = cell.getBoundingClientRect();
        const mountBox = mount.getBoundingClientRect();
        tip.style.left = `${cellBox.left - mountBox.left + cellBox.width / 2}px`;
        tip.style.top = `${cellBox.top - mountBox.top}px`;
    };

    const hide = () => {
        tip.hidden = true;
    };

    mount.addEventListener('pointerover', show);
    mount.addEventListener('pointerout', hide);
    mount.addEventListener('focusin', show);
    mount.addEventListener('focusout', hide);
}

/** On a narrow screen the grid scrolls, and the interesting end is the recent one. */
function pinToCurrentWeek(mount) {
    const scroller = mount.querySelector('.training__grid-scroll');
    if (scroller) {
        scroller.scrollLeft = scroller.scrollWidth;
    }
}

/* ==========================================================================
   Helpers
   ========================================================================== */

/**
 * Three outcomes only: today, yesterday, or the date. Anything vaguer ("3 weeks
 * ago") makes the reader do arithmetic to work out what they are actually looking at.
 *
 * Computed here from the absolute date in the JSON rather than baked in upstream. If
 * the file goes stale, "6 September" is still true; a stored "yesterday" is a lie by
 * Tuesday.
 */
function relativeDay(iso) {
    const then = startOfDay(new Date(`${iso}T00:00:00`));
    const now = startOfDay(new Date());
    const days = Math.round((now - then) / 86400000);

    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';

    return longDate(iso, then.getFullYear() !== now.getFullYear());
}

/**
 * The year is only worth showing when it is not the current one — which also stops a
 * dashboard that has gone quiet for a year reading as if the last session were recent.
 */
function longDate(iso, withYear = false) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        ...(withYear ? { year: 'numeric' } : {})
    });
}

function shortMonth(date) {
    return date.toLocaleDateString('en-GB', { month: 'short' });
}

function toIsoDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

function startOfDay(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
}

/** Days from Monday, so Sunday closes the week rather than opening it. */
function mondayOffset(date) {
    return (date.getDay() + 6) % 7;
}

function formatNumber(value) {
    return Number(value).toLocaleString('en-GB', { maximumFractionDigits: 1 });
}

function pluralise(count, word) {
    return count === 1 ? word : `${word}s`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}
