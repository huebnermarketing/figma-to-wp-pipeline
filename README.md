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
| 7 | Playwright takes screenshots at desktop / tablet / mobile + Claude Vision QA | ~25s |

**Total for a 3-page site: ~60–90 minutes of manual work → ~3–5 minutes automated.**

---

## Prerequisites

### On Your Machine

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
| Permalinks enabled (any structure) | REST API routing |

### Accounts / API Keys

| Service | Where to Get |
|---------|-------------|
| **Figma Personal Access Token** | figma.com → Account Settings → Personal Access Tokens |
| **Anthropic API Key** | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| **WordPress Application Password** | WP Admin → Users → Profile → Application Passwords |

---

## One-Time Setup

### Step 1: Clone and Install

```bash
git clone https://github.com/huebnermarketing/figma-to-wp-pipeline.git
cd figma-to-wp-pipeline
npm install
npx playwright install chromium
```

> `npx playwright install chromium` downloads a headless browser (~150MB) for QA screenshots. Only needed once.

---

### Step 2: Configure Environment Variables

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx
WP_URL=https://yoursite.com
WP_USER=admin
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
```

**How to get each value:**

**FIGMA_TOKEN**
1. Go to figma.com → click your avatar → Settings → Security tab
2. Under "Personal access tokens" → Generate new token → copy it

**ANTHROPIC_API_KEY**
1. Go to [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key → copy it
2. Make sure you have billing set up (add a card or credits)

**WP_URL** — your WordPress site URL, no trailing slash: `https://yoursite.com`

**WP_USER** — your WordPress admin username

**WP_APP_PASSWORD**
1. WP Admin → Users → Profile → scroll to "Application Passwords"
2. Enter name "Figma Pipeline" → Add New → copy the generated password
3. Paste as-is (spaces are fine — stripped automatically)

---

### Step 3: Install the WordPress Companion Plugin

Needed to write Elementor data to pages and apply global settings.

**Method A — Direct upload:**
1. Copy `wordpress-plugin/figma-pipeline-bridge.php` to your server at:
   `wp-content/plugins/figma-pipeline-bridge/figma-pipeline-bridge.php`
2. WP Admin → Plugins → find "Figma Pipeline Bridge" → Activate

**Method B — Via WordPress Admin:**
1. Zip the `wordpress-plugin/` folder
2. WP Admin → Plugins → Add New → Upload Plugin → Install → Activate

> Without this plugin pages will be created but Elementor data won't be applied.

---

## Running the Pipeline

```bash
node pipeline.js --figma-url="https://www.figma.com/file/YOUR_FILE_ID/Your-File-Name"
```

Watch the terminal — it logs every stage in real time.

### Finding Your Figma URL

Open your Figma file in the browser and copy the full URL:
`https://www.figma.com/file/AbC123XyZ/My-Website-Design`

> Both `/file/` and `/design/` URLs are supported.

---

## Resume & Recovery Commands

**The pipeline saves every stage's output to disk. If it breaks at any stage, nothing is lost — just fix the issue and resume.**

### Resume automatically (recommended)

Re-run the same command — the pipeline detects which stages are already done and skips them:

```bash
node pipeline.js --from-stage=5
```

### Resume from a specific stage

```bash
node pipeline.js --from-stage=1   # restart everything
node pipeline.js --from-stage=2   # re-run token extraction onwards
node pipeline.js --from-stage=3   # re-run Elementor config onwards
node pipeline.js --from-stage=4   # re-run HTML blueprints onwards
node pipeline.js --from-stage=5   # re-run template generation onwards
node pipeline.js --from-stage=6   # re-deploy to WordPress only
node pipeline.js --from-stage=7   # re-run QA only
```

> Stages 1–4 don't need `--figma-url` when resuming — they load from saved output files.

### Run a single stage only

```bash
node pipeline.js --only-stage=5   # regenerate templates only
node pipeline.js --only-stage=6   # redeploy to WordPress only
node pipeline.js --only-stage=7   # rerun QA only
```

### Skip QA (faster)

```bash
node pipeline.js --figma-url="..." --skip-qa
node pipeline.js --from-stage=6 --skip-qa
```

---

## Troubleshooting

### ❌ Rate limit error (429) — "would exceed your organization's rate limit"

**Cause:** Your Anthropic plan has a low tokens-per-minute limit (free/starter = 4,000 output tokens/min).

**Fix:**
```bash
# Wait 60 seconds, then resume with a longer delay between calls:
RATE_LIMIT_MS=20000 node pipeline.js --from-stage=5
```

The pipeline will **auto-retry up to 5 times** and wait for the rate limit to reset — you'll see:
```
⏳  Rate limit hit [gen_template:home] — waiting 60s before retry (attempt 1/5)...
```

To make the delay permanent, add to your `.env`:
```env
RATE_LIMIT_MS=20000
```

To avoid rate limits entirely, **add billing credits** at [console.anthropic.com](https://console.anthropic.com) — paid accounts have much higher limits (up to 2M tokens/min on higher tiers).

---

### ❌ "No top-level frames found"

**Cause:** Your Figma design uses Groups instead of Frames at the top level.

**Fix:** In Figma, select your content → press `F` to wrap it in a Frame. The pipeline reads top-level Frame nodes on each Figma page.

---

### ❌ Figma API 403 — "Forbidden"

**Cause:** Your FIGMA_TOKEN is invalid, expired, or doesn't have access to this file.

**Fix:**
1. Generate a new token: figma.com → Settings → Security → Personal Access Tokens
2. Update `FIGMA_TOKEN` in `.env`
3. Resume: `node pipeline.js --from-stage=1 --figma-url="..."`

---

### ❌ WordPress 401 — "Authentication failed"

**Cause:** Wrong WP_USER or WP_APP_PASSWORD.

**Fix:**
1. Double-check `WP_USER` is your exact WordPress username (not email)
2. Re-generate Application Password: WP Admin → Users → Profile → Application Passwords
3. Paste the new password into `.env`
4. Resume: `node pipeline.js --from-stage=6`

> Application Passwords may be blocked by some hosting providers (e.g., some WP Engine configs). Contact your host if this persists.

---

### ❌ WordPress 404 — "REST API not found"

**Cause:** Permalinks are not set up, or WP_URL is wrong.

**Fix:**
1. WP Admin → Settings → Permalinks → click **Save Changes** (even without changing anything — this regenerates `.htaccess`)
2. Make sure `WP_URL` has no trailing slash: `https://yoursite.com` ✓ not `https://yoursite.com/` ✗
3. Resume: `node pipeline.js --from-stage=6`

---

### ❌ "elementor_data meta field not writable" / Bridge plugin not found

**Cause:** The `figma-pipeline-bridge` companion plugin is not installed on WordPress.

**Fix:** Install the plugin (see Setup Step 3). Without it, WordPress blocks writes to private meta fields starting with `_`.

---

### ❌ Template JSON invalid / truncated at Stage 5

**Cause:** Claude's response was cut off before completing the JSON (very large landing pages).

**What happens automatically:** The pipeline retries with a simplified prompt (3 attempts), then falls back to a minimal skeleton page you can edit in Elementor.

**If it keeps failing:**
```bash
# Use a faster model with higher output limits
CLAUDE_MODEL=claude-opus-4-6 node pipeline.js --from-stage=5
```

---

### ❌ Screenshots are blank or white (Stage 7)

**Cause:** The page is behind a login wall, in maintenance mode, or not yet published.

**Fix:**
1. Check the page URL from Stage 6 output — open it in a browser while logged out
2. Disable maintenance mode if enabled
3. Rerun QA: `node pipeline.js --only-stage=7`

---

### ❌ "Cannot connect to WordPress" / ECONNREFUSED

**Cause:** WP_URL is wrong or the site is down.

**Fix:**
1. Visit `WP_URL/wp-json/` in your browser — you should see a JSON response
2. If it 404s, Permalinks need saving (see above)
3. If it times out, the site may be down or behind a firewall
4. Resume after fixing: `node pipeline.js --from-stage=6`

---

### ❌ `npx playwright install chromium` fails

**Fix:**
```bash
# Try with sudo on Mac/Linux
sudo npx playwright install chromium

# Or install system dependencies first (Linux)
npx playwright install-deps chromium
npx playwright install chromium
```

---

### ✅ General debugging tip

Set `DEBUG=true` in your `.env` to get full error stack traces:
```bash
DEBUG=true node pipeline.js --from-stage=5
```

---

## Output Files

After the pipeline runs, your `output/` folder contains:

```
output/
├── figma-raw.json              # Full Figma file (for debugging / resuming)
├── design-tokens.json          # Extracted colours, fonts, spacing
├── elementor-config.json       # Global Elementor settings applied to WP
├── deployment-report.json      # Deployed page URLs
├── qa-report.json              # Full QA audit with scores and issues
│
├── blueprints/
│   ├── home.html               # HTML blueprint — Home
│   └── about.html              # HTML blueprint — About
│
├── templates/
│   ├── home.json               # Elementor JSON — Home (deployed to WP)
│   └── about.json              # Elementor JSON — About (deployed to WP)
│
└── screenshots/
    ├── home-desktop.png        # 1440px screenshot
    ├── home-tablet.png         # 768px screenshot
    └── home-mobile.png         # 390px screenshot
```

All output files are saved after each stage. If the pipeline breaks, resume — these files are reused automatically.

---

## Understanding the QA Report

| Score | Meaning | What to Do |
|-------|---------|-----------|
| 90–100% | Excellent | No changes needed |
| 75–89%  | Good — minor differences | Optional tweaks in Elementor |
| 60–74%  | Layout drift | Review screenshot, adjust in Elementor |
| Below 60% | Significant issues | Check `issues` field, fix manually in Elementor |

Re-run QA after fixing: `node pipeline.js --only-stage=7`

---

## What Claude Does vs What You Still Do

### Automated
- Fetch and parse the Figma file
- Extract the full design system (colours, fonts, spacing)
- Generate Elementor global typography and colour kit
- Create HTML structure for every Figma frame
- Convert HTML → Elementor widget JSON
- Deploy and publish pages on WordPress
- QA screenshots at 3 breakpoints + fidelity scoring

### Still Requires Human Review
- **Real content** — replace placeholder text/images with actual copy and photos
- **Low-fidelity pages** — if QA score < 80%, open in Elementor and adjust
- **Custom functionality** — contact forms, WooCommerce, ACF fields, booking widgets
- **Mobile fine-tuning** — complex responsive layouts may need manual CSS
- **SEO** — page titles, meta descriptions, Open Graph tags
- **Client review and sign-off**

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FIGMA_TOKEN` | ✓ | — | Figma Personal Access Token |
| `ANTHROPIC_API_KEY` | ✓ | — | Anthropic / Claude API key |
| `WP_URL` | ✓ | — | WordPress site URL (no trailing slash) |
| `WP_USER` | ✓ | — | WordPress admin username |
| `WP_APP_PASSWORD` | ✓ | — | WordPress Application Password |
| `RATE_LIMIT_MS` | — | `500` | Delay (ms) between Claude API calls. Set to `20000` on free Anthropic plans |
| `OUTPUT_DIR` | — | `./output` | Where generated files are saved |
| `CLAUDE_MODEL` | — | `claude-opus-4-6` | Claude model (`claude-sonnet-4-6` is faster/cheaper) |
| `DEBUG` | — | — | Set to `true` for full error stack traces |

---

## Project Structure

```
figma-to-wp-pipeline/
│
├── pipeline.js                      ← Run this
├── package.json
├── .env.example                     ← Copy to .env and fill in
├── .gitignore
│
├── stages/
│   ├── fetch_figma.js               Stage 1: Figma REST API
│   ├── extract_tokens.js            Stage 2: Claude extracts design tokens
│   ├── gen_elementor_config.js      Stage 3: Claude → Elementor global settings
│   ├── gen_html_blueprints.js       Stage 4: Claude → HTML per page
│   ├── gen_elementor_templates.js   Stage 5: Claude → Elementor JSON
│   ├── deploy_to_wordpress.js       Stage 6: WP REST API deployment
│   └── run_qa.js                    Stage 7: Playwright + Claude Vision QA
│
├── utils/
│   └── claude_call.js               Rate-limit-aware Claude API wrapper (auto-retry)
│
├── wordpress-plugin/
│   └── figma-pipeline-bridge.php    ← Install on your WordPress site
│
└── output/                          ← Auto-created, all generated files saved here
```

---

## Cost Estimate (Claude API)

For a 3-page Figma design with `claude-opus-4-6`:

| Stage | Calls | Approx Tokens | Cost |
|-------|-------|--------------|------|
| 2 — Extract tokens | 1 | ~2,000 | ~$0.03 |
| 3 — Elementor config | 1 | ~1,800 | ~$0.02 |
| 4 — HTML blueprints | 3 | ~12,000 | ~$0.18 |
| 5 — Elementor templates | 3 | ~24,000 | ~$0.36 |
| 7 — QA vision | 6 | ~6,000 | ~$0.09 |
| **Total** | **14** | **~46,000** | **~$0.68** |

Switch to `claude-sonnet-4-6` (set `CLAUDE_MODEL=claude-sonnet-4-6` in `.env`) for ~3× lower cost with slightly less output quality.

Check current pricing at [anthropic.com/pricing](https://anthropic.com/pricing).
