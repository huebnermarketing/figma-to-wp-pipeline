# Figma → WordPress Elementor Pipeline

**Fully automated. One command. No manual steps.**

You paste a Figma file URL. Claude AI reads the design, extracts tokens, generates Elementor templates, deploys them to WordPress, and runs visual QA — automatically.

---

## What This Does

| Step | What Happens | Time |
|------|-------------|------|
| 1 | Fetches your Figma file via REST API | ~2s |
| 2 | Claude AI extracts colours, fonts, spacing (design tokens) | ~10s |
| 3 | Claude AI generates Elementor global settings (colour palette, typography kit) | ~8s |
| 4 | Claude AI writes semantic HTML for each Figma page frame | ~8s per page |
| 5 | Claude AI converts each HTML blueprint → Elementor page template JSON | ~15s per page |
| 6 | Deploys all templates to WordPress via REST API + activates pages | ~15s |
| 7 | Playwright takes screenshots at desktop / tablet / mobile | ~20s |
| 7 | Claude Vision compares screenshots vs Figma design and scores fidelity | ~5s per screenshot |

**Total for a 3-page site: ~60–90 minutes of manual work → ~3–5 minutes automated.**

---

## Prerequisites

### On Your Machine (Developer)

| Tool | Install | Check |
|------|---------|-------|
| Node.js 18+ | [nodejs.org](https://nodejs.org) | `node --version` |
| npm 9+ | Included with Node | `npm --version` |

### WordPress Site Requirements

| Requirement | Why |
|------------|-----|
| WordPress 5.8+ | REST API meta support |
| Elementor plugin (free) | Page builder rendering |
| Application Passwords enabled | REST API authentication |
| Permalinks enabled | REST API routing |

### Accounts / API Keys

| Service | Where to Get |
|---------|-------------|
| **Figma Personal Access Token** | figma.com → Account Settings → Personal Access Tokens |
| **Anthropic API Key** | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| **WordPress Application Password** | WP Admin → Users → Profile → Application Passwords section |

---

## One-Time Setup

### Step 1: Clone and Install

```bash
git clone https://github.com/your-org/figma-to-wp-pipeline
cd figma-to-wp-pipeline
npm install
npx playwright install chromium
```

> `npx playwright install chromium` downloads a headless browser (~150MB) for the QA screenshots stage. Only needed once.

---

### Step 2: Configure Environment Variables

```bash
cp .env.example .env
```

Open `.env` in any text editor and fill in your values:

```env
FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx
WP_URL=https://yoursite.com
WP_USER=admin
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
```

**How to get each value:**

**FIGMA_TOKEN**
1. Go to figma.com and sign in
2. Click your avatar (top-left) → Settings → Security tab
3. Under "Personal access tokens" → click "Generate new token"
4. Give it a name, copy the token, paste it in `.env`

**ANTHROPIC_API_KEY**
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Click "API Keys" in the left sidebar
3. Click "Create Key", copy it, paste it in `.env`

**WP_URL**
- Just your WordPress site URL, no trailing slash: `https://yoursite.com`
- Must be a live, publicly accessible site (not localhost unless you use ngrok)

**WP_USER**
- Your WordPress admin username (the one you log in with)

**WP_APP_PASSWORD**
1. Log in to WordPress Admin
2. Go to Users → Profile (or Users → All Users → click your user → Edit)
3. Scroll to the bottom: "Application Passwords" section
4. Enter a name like "Figma Pipeline" → click "Add New Application Password"
5. Copy the generated password (format: `xxxx xxxx xxxx xxxx`)
6. Paste it in `.env` — spaces are fine, they're stripped automatically

---

### Step 3: Install the WordPress Companion Plugin

The companion plugin allows the pipeline to write Elementor data to WordPress pages and apply global settings.

**Method A: Direct upload (easiest)**
1. Go to `wordpress-plugin/` folder in this project
2. Copy `figma-pipeline-bridge.php` to your server's `wp-content/plugins/figma-pipeline-bridge/` directory
3. Go to WP Admin → Plugins → find "Figma Pipeline Bridge" → click Activate

**Method B: Via WordPress Admin**
1. Zip the `wordpress-plugin/` folder
2. WP Admin → Plugins → Add New → Upload Plugin → choose the zip
3. Install → Activate

> **Note:** The pipeline will still work without this plugin — pages will be created but may not have Elementor data applied. Install the plugin for full functionality.

---

## Running the Pipeline

```bash
node pipeline.js --figma-url="https://www.figma.com/file/YOUR_FILE_ID/Your-File-Name"
```

That's it. Watch the terminal as the pipeline runs through all 7 stages.

### Finding Your Figma URL

1. Open your Figma file in the browser
2. Copy the URL from the address bar
3. It should look like: `https://www.figma.com/file/AbC123XyZ/My-Website-Design`

### Example Output

```
────────────────────────────────────────────────────────────
  🚀  Figma → WordPress Elementor Pipeline
────────────────────────────────────────────────────────────
  Figma URL : https://figma.com/file/AbC123/My-Website
  WP Site   : https://yoursite.com
  Output    : ./output
  Model     : claude-opus-4-6

[1/7] Fetching Figma file...
[09:12:01] 1/7 ✓  Fetched in 1.4s  — 3 frames found
      · Home (12345)
      · About (12346)
      · Services (12347)

[2/7] Extracting design tokens with Claude...
[09:12:12] 2/7 ✓  Extracted in 9.2s
      · Colors: 10
      · Type scales: 6
      · Spacing values: 10

[3/7] Generating Elementor global config with Claude...
[09:12:19] 3/7 ✓  Generated in 6.8s  — elementor-config.json written

[4/7] Generating HTML blueprints with Claude...
      Generating HTML for: Home... ✓
      Generating HTML for: About... ✓
      Generating HTML for: Services... ✓
[09:12:52] 4/7 ✓  Generated 3 blueprint(s) in 32.5s

[5/7] Converting blueprints to Elementor templates with Claude...
      Generating Elementor template: home... ✓
      Generating Elementor template: about... ✓
      Generating Elementor template: services... ✓
[09:13:38] 5/7 ✓  Generated 3 template(s) in 46.2s

[6/7] Deploying to WordPress...
      · Connected as: Admin (administrator)
      · Elementor global settings applied ✓
      · Published: "Home"  →  https://yoursite.com/home/
      · Published: "About"  →  https://yoursite.com/about/
      · Published: "Services"  →  https://yoursite.com/services/
[09:13:55] 6/7 ✓  Deployed 3 page(s) in 17.1s

[7/7] Running automated QA with Playwright + Claude Vision...
      Checking home/desktop... ✓ 96%
      Checking home/tablet... ✓ 92%
      Checking home/mobile... ⚠ 78%
      Checking about/desktop... ✓ 98%
      Checking services/desktop... ✓ 94%

────────────────────────────────────────────────────────────
  ✅  Pipeline Complete — 214s total
────────────────────────────────────────────────────────────

  QA Results:
  ✓  home / desktop   96%
  ✓  home / tablet    92%
  ⚠  home / mobile    78%  hero padding slightly off
  ✓  about / desktop  98%
  ✓  services/desktop 94%

  Output files: ./output/
  QA report  : ./output/qa-report.json
  Screenshots: ./output/screenshots/
```

---

## Output Files

After the pipeline runs, your `output/` folder contains:

```
output/
├── figma-raw.json              # Full Figma file data (for debugging)
├── design-tokens.json          # Extracted colours, fonts, spacing
├── elementor-config.json       # Global Elementor settings applied to WP
├── deployment-report.json      # List of deployed pages with URLs
├── qa-report.json              # Full QA audit with scores and issues
│
├── blueprints/
│   ├── home.html               # HTML blueprint for Home page
│   ├── about.html              # HTML blueprint for About page
│   └── services.html           # HTML blueprint for Services page
│
├── templates/
│   ├── home.json               # Elementor JSON template (Home)
│   ├── about.json              # Elementor JSON template (About)
│   └── services.json           # Elementor JSON template (Services)
│
└── screenshots/
    ├── home-desktop.png        # Playwright screenshot 1440px
    ├── home-tablet.png         # Playwright screenshot 768px
    ├── home-mobile.png         # Playwright screenshot 390px
    └── ...
```

---

## Understanding the QA Report

Open `output/qa-report.json` or check the terminal summary:

| Score | Meaning | Action |
|-------|---------|--------|
| 90–100% | Excellent fidelity | No changes needed |
| 75–89%  | Good — minor differences | Optional tweaks in Elementor |
| 60–74%  | Acceptable — some layout drift | Review the screenshot and adjust in Elementor |
| Below 60% | Significant issues | Check the `issues` field and fix manually |

The QA report tells you specifically what's wrong (e.g., "hero section padding doesn't match", "button colour is off") so you know exactly what to fix.

---

## What Claude Does vs What You Still Do

### Automated (zero user input)
- Fetching and parsing the Figma file
- Extracting the full design system (colours, fonts, spacing)
- Generating Elementor global typography and colour kit
- Creating HTML structure for every Figma frame
- Converting HTML to Elementor widget JSON
- Deploying pages to WordPress and activating them
- Taking QA screenshots at 3 breakpoints
- Scoring visual fidelity and flagging issues

### Still Requires Human Review
- **Real content** — the pipeline generates placeholder text/images; you replace with actual copy and photos
- **Low-fidelity pages** — if QA score is below 80%, open in Elementor and adjust
- **Custom functionality** — contact forms, booking widgets, WooCommerce, ACF fields
- **Mobile CSS fine-tuning** — complex responsive layouts may need manual adjustment
- **SEO and metadata** — titles, descriptions, Open Graph
- **Client review and sign-off**

---

## Troubleshooting

### "No top-level frames found"
- Open your Figma file and check: the designs must be inside Frame elements (not groups)
- Press `F` in Figma to create frames, drag your content inside them

### "Figma API returned 403"
- Your FIGMA_TOKEN is invalid or expired — generate a new one
- The file may be private — check you have View access with the token owner's account

### "WordPress authentication failed (401)"
- Check WP_USER and WP_APP_PASSWORD in `.env`
- Make sure Application Passwords are enabled on your WordPress installation
- Application Passwords may be disabled by your hosting provider — check with them

### "WordPress REST API not found (404)"
- Go to WP Admin → Settings → Permalinks and click Save (re-generates the `.htaccess` routing)
- Check WP_URL has no trailing slash

### "elementor_data meta field not writable"
- Install the `figma-pipeline-bridge` WordPress plugin (see Setup Step 3)
- This is needed because WordPress protects private meta fields by default

### Claude API errors
- Check ANTHROPIC_API_KEY is valid
- Check your API quota at console.anthropic.com
- If you get rate limit errors, increase RATE_LIMIT_MS in `.env` to 1500 or 2000

### Screenshots are blank / white
- The page URL may need authentication (WP in maintenance mode?)
- Try setting `WP_DEBUG=true` in WordPress and checking error logs

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FIGMA_TOKEN` | ✓ | — | Figma Personal Access Token |
| `ANTHROPIC_API_KEY` | ✓ | — | Claude API key |
| `WP_URL` | ✓ | — | WordPress site URL (no trailing slash) |
| `WP_USER` | ✓ | — | WordPress admin username |
| `WP_APP_PASSWORD` | ✓ | — | WordPress Application Password |
| `RATE_LIMIT_MS` | — | `500` | Delay between Claude API calls (ms) |
| `OUTPUT_DIR` | — | `./output` | Where to write generated files |
| `CLAUDE_MODEL` | — | `claude-opus-4-6` | Claude model to use |
| `DEBUG` | — | — | Set to `true` for full error stack traces |

---

## Project Structure

```
figma-to-wp-pipeline/
│
├── pipeline.js                   ← Run this
├── package.json
├── .env.example                  ← Copy to .env and fill in
├── .gitignore
│
├── stages/
│   ├── fetch_figma.js            Stage 1: Fetch Figma via REST API
│   ├── extract_tokens.js         Stage 2: Claude extracts design tokens
│   ├── gen_elementor_config.js   Stage 3: Claude generates global settings
│   ├── gen_html_blueprints.js    Stage 4: Claude writes HTML per page
│   ├── gen_elementor_templates.js  Stage 5: Claude converts HTML → Elementor JSON
│   ├── deploy_to_wordpress.js    Stage 6: REST API deployment
│   └── run_qa.js                 Stage 7: Playwright + Claude Vision QA
│
├── wordpress-plugin/
│   └── figma-pipeline-bridge.php ← Install this on your WordPress site
│
└── output/                       ← Auto-created when pipeline runs
    ├── design-tokens.json
    ├── elementor-config.json
    ├── blueprints/
    ├── templates/
    ├── screenshots/
    └── qa-report.json
```

---

## Updating / Re-running

You can re-run the pipeline at any time. If a page already exists in WordPress, it will be updated (not duplicated).

If you only want to re-deploy without re-generating (faster):
- The templates are saved in `output/templates/*.json`
- You can manually import them in WP Admin → Elementor → My Templates → Import

---

## Cost Estimate (Claude API)

For a 3-page Figma design:
- Stage 2: ~1,500 tokens input + 500 output = ~2,000 tokens
- Stage 3: ~1,000 tokens input + 800 output = ~1,800 tokens
- Stage 4: ~3 calls × ~3,000 tokens each = ~9,000 tokens
- Stage 5: ~3 calls × ~6,000 tokens each = ~18,000 tokens
- Stage 7 (vision): ~6 calls × ~1,000 tokens each = ~6,000 tokens

**Total: ~37,000 tokens ≈ $0.37–$1.10 USD** depending on model pricing.

Check current pricing at [anthropic.com/pricing](https://anthropic.com/pricing).
