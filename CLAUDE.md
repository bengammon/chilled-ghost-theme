# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install         # install dependencies
npm run dev         # start development mode with livereload
npm run build       # compile CSS and JS for production (output to assets/built/)
npm run zip         # build + create distributable zip
npm run test        # run gscan compatibility check (runs build first)
```

There is no test runner beyond `gscan`, which validates Ghost theme compatibility rather than running unit tests.

## Architecture

This is a custom [Ghost](https://ghost.org) theme for bengammon.co.uk built on the Ghost Starter Theme. Ghost uses [Handlebars](https://handlebarsjs.com/) (`.hbs`) for templating.

### Template hierarchy

- `default.hbs` — root layout shell: `<head>` (including the inline script that re-applies a stored light/dark choice before paint), `{{ghost_head}}`, `{{ghost_foot}}`, wraps all pages with `{{> header}}` and `{{> footer}}`. `<main>` gets the centred `.column` on every page except posts, which lay out their own grid
- `index.hbs` — home page: intro, five recent posts (`tag:-note`), a training summary filled by `training.js` (hidden unless the data loads), and the two latest notes (`tag:note`), both as `{{> post-teaser}}` rows
- `archive.hbs` — `/archive/` (formerly `/blog/`, which 301s here): every post and note on one page (`limit: all` in routes.yaml), as `{{> post-teaser}}` rows with year headings. `tag.hbs` and `author.hbs` are single pages too, because `posts_per_page` in package.json is 1000; nothing renders `{{> pagination}}` any more
- `post.hbs` — individual post/note view: a three-column `.post__layout` grid with the reading column in the middle and, on `#toc` posts, the contents list in the left margin from 1120px
- `page-training.hbs` — the `/training` page: Ghost content plus `{{> training-dashboard}}`
- `page.hbs`, `author.hbs`, `tag.hbs`, `error.hbs` — standard Ghost templates
- `notes.hbs` — unused: the `/notes` route was retired, and notes now live in `/archive/` and `/tag/note/`

The site distinguishes "posts" (long-form writing) from "notes" (short-form) via the Ghost tag `note`. Notes get a smaller title on `post.hbs`, with their date and tags under the text and no reading time.

### Partials (`partials/`)

- `header.hbs` / `footer.hbs` — site chrome: logo, nav, search and theme buttons (a Menu panel below 600px); footer links and copyright
- `navigation.hbs` — rendered by Ghost's `{{navigation}}` helper, so items carry `current`
- `post-meta.hbs` — date, optional reading time and tags, in mono
- `post-teaser.hbs` — date-and-title row used in the archives and on the home page
- `table-of-contents.hbs` — `<details>` shell that Tocbot fills on `#toc` posts
- `training-dashboard.hbs` — mount point for `training.js`
- `tags.hbs`, `pagination.hbs` — utility partials
- `post-note.hbs` — unused since `/notes` was retired

### Asset pipeline

Rollup bundles everything from `assets/js/index.js` and `assets/css/index.scss`, outputting to `assets/built/`. The pipeline uses:

- **PostCSS** with `postcss-import` and `postcss-preset-env` for CSS (CSS variables are kept as-is — `custom-properties: false` in config)
- **Terser** for JS minification. There is no Babel: with `browserslist: ["defaults"]` it changed nothing in the bundle, so it was removed (2026-11). If new JS syntax ever needs transpiling for the target browsers, it would have to come back
- **Livereload** in dev mode, watching `.hbs` files too

### CSS structure (`assets/css/`)

Layered ITCSS-style architecture imported via `index.scss`:

1. `reset` — baseline reset
2. `variables/` — CSS custom properties. `_color.scss` defines the palette (`--colorBg`, `--colorSurface`, `--colorFg`, `--colorMuted`, `--colorRule`, `--colorAccent` orange, `--colorAccentB` blue) for light and dark, switched by `prefers-color-scheme` or `data-theme` on `<html>`, and maps the older semantic names onto it. `_typography.scss` sets the families (Archivo for UI and headings, Source Serif 4 for running text via `.prose`, JetBrains Mono for dates, data and code). `_max-width.scss` sets `--measure` and `--columnGutter`, which together make the 640px reading column
3. `settings/` — self-hosted variable `@font-face` rules, breakpoints (including `$bp-post-margin`), borders, themes
4. `tools/` — mixins and functions (media queries, theming, active states)
5. `layout/` — grid/column layout
6. `defaults/` — element defaults (blockquote, code, figure, pre, image)
7. `components/` — UI components (header, footer, card, button, form, pagination, etc.)
8. `helpers/` — utility classes (color, display, spacing, screen-reader)

### JavaScript modules (`assets/js/`)

- `index.js` — entry point; imports CSS and calls all modules
- `menuOpen.js` — toggles `gh-head-open` on `<body>` for the mobile menu panel
- `theme.js` — the header's light/dark button; stores the choice in `localStorage` (`theme`) and keeps `aria-pressed` and the `theme-color` metas in step
- `postNumber.js` — fetches all posts from Ghost Content API (`/ghost/api/content/posts/`) to calculate and display a sequential post number (`#N`) on each post. Requires `window.ghostContentApiKey` to be set
- `subscribeCta.js` — listens for Ghost Portal signup events (`ghost-members:signup:success/error`) and updates subscribe form UI state
- `toc.js` — initialises the vendored [Tocbot](https://tscanlin.github.io/tocbot/) (`tocbot.min.js`) on `.gh-toc` / `.js-toc-content`, opens the list in the margin, counts sections, and drives the progress rail and "min left" line
- `training.js` — fetches `/training.json` (or `window.trainingDataUrl`) and renders the `/training` dashboard and the home page summary; renders nothing on failure

### Members templates (`members/`)

Custom Ghost members pages: `signin.hbs`, `signup.hbs`, `account.hbs`.
