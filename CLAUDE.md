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

- `default.hbs` — root layout shell: `<head>`, `{{ghost_head}}`, `{{ghost_foot}}`, wraps all pages with `{{> header}}` and `{{> footer}}`
- `index.hbs` — home page: personal intro + recent posts (tagged `tags:-note`) + recent notes (tagged `tags:note`)
- `blog.hbs` — full post archive using `{{> post-teaser}}` partial
- `notes.hbs` — notes archive using `{{> post-note}}` partial
- `post.hbs` — individual post/note view
- `page.hbs`, `author.hbs`, `tag.hbs`, `error.hbs` — standard Ghost templates

The site distinguishes "posts" (long-form writing) from "notes" (short-form) via the Ghost tag `note`. This tag is used as a filter throughout templates and the post template conditionally hides the date for notes (`{{^has tag="note"}}`).

### Partials (`partials/`)

- `header.hbs` / `footer.hbs` — site chrome
- `navigation.hbs` — nav driven by Ghost admin navigation settings
- `post-teaser.hbs` — card used in blog archive and home page
- `post-note.hbs` — compact card used in notes archive and home page
- `tags.hbs`, `pagination.hbs`, `social.hbs` — utility partials

### Asset pipeline

Rollup bundles everything from `assets/js/index.js` and `assets/css/index.scss`, outputting to `assets/built/`. The pipeline uses:

- **PostCSS** with `postcss-import` and `postcss-preset-env` for CSS (CSS variables are kept as-is — `custom-properties: false` in config)
- **Babel** + **Terser** for JS
- **Livereload** in dev mode, watching `.hbs` files too

### CSS structure (`assets/css/`)

Layered ITCSS-style architecture imported via `index.scss`:

1. `reset` — baseline reset
2. `variables/` — raw SCSS variables (not CSS custom properties)
3. `settings/` — design tokens: colors (`$color-brand-primary: #3ce854`, `$color-brand-secondary: #070f26`), breakpoints, borders, themes
4. `tools/` — mixins and functions (media queries, theming, active states)
5. `layout/` — grid/column layout
6. `defaults/` — element defaults (blockquote, code, figure, pre, image)
7. `components/` — UI components (header, footer, card, button, form, pagination, etc.)
8. `helpers/` — utility classes (color, display, spacing, screen-reader)

### JavaScript modules (`assets/js/`)

- `index.js` — entry point; imports CSS and calls all modules
- `menuOpen.js` — toggles `gh-head-open` on `<body>` for mobile nav
- `postNumber.js` — fetches all posts from Ghost Content API (`/ghost/api/content/posts/`) to calculate and display a sequential post number (`#N`) on each post. Requires `window.ghostContentApiKey` to be set in `default.hbs`
- `subscribeCta.js` — listens for Ghost Portal signup events (`ghost-members:signup:success/error`) and updates subscribe form UI state
- `tocbot.min.js` — vendored [Tocbot](https://tscanlin.github.io/tocbot/) for table of contents on posts; configured in `index.js` to target `.gh-toc` / `.gh-content`

### Members templates (`members/`)

Custom Ghost members pages: `signin.hbs`, `signup.hbs`, `account.hbs`.
