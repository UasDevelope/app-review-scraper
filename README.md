# App Store & Google Play Scraper (Node.js)

Collect **user reviews** (rating + text), **app descriptions**, and **Terms of Service / Privacy Policy links** from **Google Play** and the **Apple App Store**.

Works on **Windows**, Mac, and Linux.

## Requirements

- [Node.js 18+](https://nodejs.org/) (LTS recommended)

## Setup

```bash
npm install
cp apps.example.json apps.json
```

### Windows quick start

1. Install Node.js from https://nodejs.org/
2. Open **Command Prompt** in this folder
3. Run:
   ```bat
   npm install
   start-ui.bat
   ```
4. Open **http://localhost:3456** in your browser

## Web UI (recommended)

```bash
npm run dev
```

Auto-restarts when you edit `src/` or `public/`, and the browser refreshes automatically.

Production-style (no file watching):

```bash
npm run ui
```

Or on Windows, double-click **`start-ui.bat`**.

- Paste **Google Play** or **App Store** links separately
- Pick a **country** — fetches all reviews for that country (up to 500 on iOS)
- Preview table paginates **20 reviews per page**; download CSV/JSON/ZIP for the full set

## Command line

```bash
npm start
node src/index.js apps.json --country us
```

## Verify everything works

```bash
npm run verify
```

## Output files

| File | Contents |
|------|----------|
| `all-reviews.csv` | Every review: rating, text, date, store |
| `all-app-details.csv` | App name, description, Terms of Service URL, Privacy Policy URL |
| `all-app-details.json` | Full app metadata per store |
| `summary.json` | Review counts per app |

## Data collected per review

- Star rating (1–5)
- Review text
- Reviewer name
- Date
- App version (when available)
- Store (Android / iOS)

## Data collected per app

- Full description
- Developer name
- Score & rating count
- **Terms of Service URL** (when listed on the store page or in app description)
- **Privacy Policy URL**
- Developer website

## Store limits

| Store | Reviews |
|-------|---------|
| Google Play | Up to **5,000 most recent** reviews per country (safety cap — popular apps can have 500K+) |
| App Store | Up to **500 most recent** reviews per country (Apple limit) |

## Tech stack

- Node.js + Express (web UI)
- [google-play-scraper](https://github.com/facundoolano/google-play-scraper)
- Apple iTunes RSS + Lookup API (reliable fetch with retries)
