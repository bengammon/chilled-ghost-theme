/**
 * The light/dark theme button in the header.
 *
 * With no stored choice the theme follows the system (prefers-color-scheme in
 * variables/_color.scss). Pressing the button flips whichever theme is showing
 * and stores the result, which the inline script in default.hbs re-applies on
 * every page before it paints.
 *
 * The button is a toggle for "Dark theme", so aria-pressed tracks whether the
 * dark theme is showing, including when it came from the system.
 */

const STORAGE_KEY = 'theme';
const THEME_COLORS = { light: '#f6f5f1', dark: '#131312' };

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme() {
    try {
        const theme = localStorage.getItem(STORAGE_KEY);
        return theme === 'light' || theme === 'dark' ? theme : null;
    } catch (e) {
        return null;
    }
}

function currentTheme() {
    return storedTheme() || (systemDark.matches ? 'dark' : 'light');
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    // Both theme-color tags carry a media query for the system theme, so an
    // explicit choice has to overwrite both to win.
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
        meta.setAttribute('content', THEME_COLORS[theme]);
    });

    try {
        localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
        // Storage can be blocked; the choice then lasts for this page only.
    }
}

export default function initTheme() {
    const buttons = document.querySelectorAll('.js-theme-toggle');

    if (!buttons.length) return;

    const syncButtons = () => {
        const isDark = currentTheme() === 'dark';
        buttons.forEach((button) => button.setAttribute('aria-pressed', String(isDark)));
    };

    buttons.forEach((button) => {
        button.addEventListener('click', () => {
            applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
            syncButtons();
        });
    });

    // Keep the pressed state honest if the system theme changes while the
    // page is open and nothing has been chosen yet.
    systemDark.addEventListener('change', syncButtons);

    syncButtons();
}
