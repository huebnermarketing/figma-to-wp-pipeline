#!/usr/bin/env node
"use strict";
/**
 * pipeline.js — Master Orchestrator
 * Figma In. WordPress Out.
 *
 * Usage:
 *   node pipeline.js --figma-url="https://www.figma.com/file/ABC123/MyWebsite"
 *
 * Resume from a specific stage (skips already-completed stages automatically):
 *   node pipeline.js --from-stage=6
 *   node pipeline.js --from-stage=7
 *
 * Force re-run a specific stage only:
 *   node pipeline.js --only-stage=5
 *
 * Skip QA (faster deploys):
 *   node pipeline.js --figma-url="..." --skip-qa
 */

require("dotenv").config();
const path  = require("path");
const fs    = require("fs");
const args  = require("minimist")(process.argv.slice(2));

const fetchFigma            = require("./stages/fetch_figma");
const extractTokens         = require("./stages/extract_tokens");
const genElementorConfig    = require("./stages/gen_elementor_config");
const genHtmlBlueprints     = require("./stages/gen_html_blueprints");
const genElementorTemplates = require("./stages/gen_elementor_templates");
const deployToWordPress     = require("./stages/deploy_to_wordpress");
const runQA                 = require("./stages/run_qa");

// ─── Output directory ─────────────────────────────────────────────────────────
function ensureOutputDir() {
  const dir = path.resolve(process.env.OUTPUT_DIR || "./output");
  ["", "blueprints", "templates", "screenshots"].forEach(sub => {
    const p = path.join(dir, sub);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
  return dir;
}

// ─── Check which stages are already done ─────────────────────────────────────
function detectCompletedStages(outputDir) {
  const bpDir  = path.join(outputDir, "blueprints");
  const tplDir = path.join(outputDir, "templates");

  const hasFile  = f  => fs.existsSync(path.join(outputDir, f));
  const hasGlob  = (dir, ext) => fs.existsSync(dir) &&
    fs.readdirSync(dir).some(f => f.endsWith(ext));

  return {
    1: hasFile("figma-raw.json"),
    2: hasFile("design-tokens.json"),
    3: hasFile("elementor-config.json"),
    4: hasGlob(bpDir,  ".html"),
    5: hasGlob(tplDir, ".json"),
    6: hasFile("deployment-report.json"),
    7: hasFile("qa-report.json"),
  };
}

// ─── Load stage outputs from disk ─────────────────────────────────────────────
function loadFromDisk(outputDir) {
  const read = f => JSON.parse(fs.readFileSync(path.join(outputDir, f), "utf8"));

  const bpDir  = path.join(outputDir, "blueprints");
  const tplDir = path.join(outputDir, "templates");

  const blueprints = {};
  if (fs.existsSync(bpDir)) {
    fs.readdirSync(bpDir).filter(f => f.endsWith(".html")).forEach(f => {
      blueprints[f.replace(".html", "")] = fs.readFileSync(path.join(bpDir, f), "utf8");
    });
  }

  const templates = {};
  if (fs.existsSync(tplDir)) {
    fs.readdirSync(tplDir).filter(f => f.endsWith(".json")).forEach(f => {
      templates[f.replace(".json", "")] = read(`templates/${f}`);
    });
  }

  const figmaRaw = fs.existsSync(path.join(outputDir, "figma-raw.json"))
    ? read("figma-raw.json") : null;

  // Load image map exported by Stage 1
  const figmaImages = fs.existsSync(path.join(outputDir, "figma-images.json"))
    ? read("figma-images.json") : { imageMap: {}, framePreviews: {} };

  // Reconstruct figmaData shape from saved raw file
  const figmaData = figmaRaw ? {
    fileId:        figmaRaw.fileId,
    fileName:      figmaRaw.fileName,
    frames:        figmaRaw.frames || [],
    styles:        figmaRaw.styles || {},
    document:      figmaRaw.document || {},
    imageMap:      figmaImages.imageMap      || {},
    framePreviews: figmaImages.framePreviews || {},
  } : null;

  const deployReport = fs.existsSync(path.join(outputDir, "deployment-report.json"))
    ? read("deployment-report.json") : null;

  return {
    figmaData,
    tokens:    fs.existsSync(path.join(outputDir, "design-tokens.json"))    ? read("design-tokens.json")    : null,
    config:    fs.existsSync(path.join(outputDir, "elementor-config.json")) ? read("elementor-config.json") : null,
    blueprints,
    templates,
    pages:     deployReport?.pages || null,
  };
}

// ─── Validate environment ─────────────────────────────────────────────────────
function validateEnv(fromStage) {
  const always = {
    ANTHROPIC_API_KEY: "Anthropic API key",
  };
  const forFigma = fromStage <= 1 ? {
    FIGMA_TOKEN: "Figma Personal Access Token",
  } : {};
  const forWP = fromStage <= 6 ? {
    WP_URL:          "WordPress site URL",
    WP_USER:         "WordPress admin username",
    WP_APP_PASSWORD: "WordPress Application Password",
  } : {};

  const required = { ...always, ...forFigma, ...forWP };
  const missing  = Object.entries(required)
    .filter(([k]) => !process.env[k])
    .map(([k, label]) => `  • ${k} — ${label}`);

  if (missing.length) {
    console.error("\n❌  Missing required environment variables:\n" + missing.join("\n"));
    console.error("\n  Edit your .env file and fix the values, then re-run.\n");
    process.exit(1);
  }
}

// ─── Pretty logger ────────────────────────────────────────────────────────────
function log(stage, msg) {
  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  console.log(`[${ts}] ${stage}  ${msg}`);
}
function skip(stage, msg) {
  console.log(`\x1b[2m[skipped] ${stage}  ${msg} (using saved output)\x1b[0m`);
}
function header(text) {
  console.log("\n" + "─".repeat(60));
  console.log("  " + text);
  console.log("─".repeat(60));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const figmaUrl  = args["figma-url"] || args["figma_url"] || args.f;
  const onlyStage = args["only-stage"] ? parseInt(args["only-stage"], 10) : null;
  const skipQA    = args["skip-qa"] || false;
  const outputDir = ensureOutputDir();

  // ── Determine starting stage ──────────────────────────────────────────────
  const completed = detectCompletedStages(outputDir);

  let fromStage;
  if (args["from-stage"]) {
    fromStage = parseInt(args["from-stage"], 10);
    console.log(`\n  ↻ Resuming from Stage ${fromStage} (--from-stage flag)`);
  } else if (onlyStage) {
    fromStage = onlyStage;
    console.log(`\n  ↻ Running only Stage ${onlyStage} (--only-stage flag)`);
  } else {
    // Auto-detect: find the first incomplete stage
    fromStage = [1,2,3,4,5,6,7].find(n => !completed[n]) || 1;
    if (fromStage > 1) {
      console.log(`\n  ↻ Auto-resuming from Stage ${fromStage} (Stages 1–${fromStage - 1} already complete)`);
      console.log(`     To force a full re-run: node pipeline.js --figma-url="..." --from-stage=1`);
    }
  }

  // ── figma-url is only required when running Stage 1 ──────────────────────
  if (fromStage <= 1 && !figmaUrl) {
    console.error('\nUsage: node pipeline.js --figma-url="https://figma.com/file/..."\n');
    console.error('  Or resume from a later stage: node pipeline.js --from-stage=6\n');
    process.exit(1);
  }

  validateEnv(fromStage);

  // Load any previously saved outputs
  const saved = loadFromDisk(outputDir);
  const startTime = Date.now();

  header("🚀  Figma → WordPress Elementor Pipeline");
  if (figmaUrl) console.log(`  Figma URL : ${figmaUrl}`);
  console.log(`  WP Site   : ${process.env.WP_URL || "(not required for this stage)"}`);
  console.log(`  Output    : ${outputDir}`);
  console.log(`  Model     : ${process.env.CLAUDE_MODEL || "claude-opus-4-6"}`);
  console.log(`  Starting  : Stage ${fromStage}${onlyStage ? " only" : "+"}`);

  // ── Stage 1: Fetch Figma ──────────────────────────────────────────────────
  let figmaData;
  if (shouldRun(1, fromStage, onlyStage)) {
    console.log("\n[1/7] Fetching Figma file...");
    const t = Date.now();
    figmaData = await fetchFigma(figmaUrl, outputDir);
    log("1/7 ✓", `Fetched in ${elapsed(t)}  — ${figmaData.frames.length} frames found`);
    figmaData.frames.forEach(f => console.log(`      · ${f.name} (${f.id})`));
  } else {
    figmaData = saved.figmaData;
    skip("1/7", `figma-raw.json  (${figmaData?.frames?.length || 0} frames)`);
  }

  if (onlyStage === 1) return done(startTime);

  // ── Stage 2: Extract Design Tokens ───────────────────────────────────────
  let tokens;
  if (shouldRun(2, fromStage, onlyStage)) {
    console.log("\n[2/7] Extracting design tokens with Claude...");
    const t = Date.now();
    tokens = await extractTokens(figmaData, outputDir);
    log("2/7 ✓", `Extracted in ${elapsed(t)}`);
    console.log(`      · Colors: ${Object.keys(tokens.colors || {}).length}`);
    console.log(`      · Type scales: ${Object.keys(tokens.typography || {}).length}`);
    console.log(`      · Spacing values: ${(tokens.spacing || []).length}`);
  } else {
    tokens = saved.tokens;
    skip("2/7", "design-tokens.json");
  }

  if (onlyStage === 2) return done(startTime);

  // ── Stage 3: Generate Elementor Config ────────────────────────────────────
  let config;
  if (shouldRun(3, fromStage, onlyStage)) {
    console.log("\n[3/7] Generating Elementor global config with Claude...");
    const t = Date.now();
    config = await genElementorConfig(tokens, outputDir);
    log("3/7 ✓", `Generated in ${elapsed(t)}  — elementor-config.json written`);
  } else {
    config = saved.config;
    skip("3/7", "elementor-config.json");
  }

  if (onlyStage === 3) return done(startTime);

  // ── Stage 4: Generate HTML Blueprints ────────────────────────────────────
  let blueprints;
  if (shouldRun(4, fromStage, onlyStage)) {
    console.log("\n[4/7] Generating HTML blueprints with Claude...");
    const t = Date.now();
    blueprints = await genHtmlBlueprints(figmaData.frames, tokens, outputDir, figmaData.imageMap || {});
    log("4/7 ✓", `Generated ${Object.keys(blueprints).length} blueprint(s) in ${elapsed(t)}`);
    Object.keys(blueprints).forEach(n => console.log(`      · ${n}.html`));
  } else {
    blueprints = saved.blueprints;
    skip("4/7", `blueprints/ (${Object.keys(blueprints).length} files)`);
  }

  if (onlyStage === 4) return done(startTime);

  // ── Stage 5: Generate Elementor Templates ─────────────────────────────────
  let templates;
  if (shouldRun(5, fromStage, onlyStage)) {
    console.log("\n[5/7] Converting blueprints to Elementor templates with Claude...");
    const t = Date.now();
    templates = await genElementorTemplates(blueprints, tokens, outputDir);
    log("5/7 ✓", `Generated ${Object.keys(templates).length} template(s) in ${elapsed(t)}`);
  } else {
    templates = saved.templates;
    skip("5/7", `templates/ (${Object.keys(templates).length} files)`);
  }

  if (onlyStage === 5) return done(startTime);

  // ── Stage 6: Deploy to WordPress ──────────────────────────────────────────
  let pages;
  if (shouldRun(6, fromStage, onlyStage)) {
    console.log("\n[6/7] Deploying to WordPress...");
    const t = Date.now();
    pages = await deployToWordPress(config, templates, outputDir);
    log("6/7 ✓", `Deployed ${pages.length} page(s) in ${elapsed(t)}`);
    pages.forEach(p => console.log(`      · ${p.title}  →  ${p.url}`));
  } else {
    pages = saved.pages;
    skip("6/7", `deployment-report.json (${pages?.length || 0} pages)`);
    if (pages?.length) pages.forEach(p => console.log(`      · ${p.title}  →  ${p.url}`));
  }

  if (onlyStage === 6) return done(startTime);

  // ── Stage 7: Automated QA ─────────────────────────────────────────────────
  if (skipQA) {
    console.log("\n[7/7] QA skipped (--skip-qa flag)");
    return done(startTime);
  }

  if (shouldRun(7, fromStage, onlyStage)) {
    console.log("\n[7/7] Running automated QA with Playwright + Claude Vision...");
    const t = Date.now();
    const qaResults = await runQA(pages, figmaData?.frames || [], outputDir);
    log("7/7 ✓", `QA complete in ${elapsed(t)}`);
    printQASummary(qaResults, outputDir);
  } else {
    skip("7/7", "qa-report.json");
  }

  done(startTime);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function shouldRun(stage, fromStage, onlyStage) {
  if (onlyStage) return stage === onlyStage;
  return stage >= fromStage;
}

function elapsed(t) {
  return `${((Date.now() - t) / 1000).toFixed(1)}s`;
}

function done(startTime) {
  const total = ((Date.now() - startTime) / 1000).toFixed(0);
  header(`✅  Pipeline Complete — ${total}s`);
  console.log("");
}

function printQASummary(qaResults, outputDir) {
  header("✅  Pipeline Complete");
  console.log("\n  QA Results:");
  qaResults.forEach(r => {
    const icon  = r.score >= 90 ? "✓" : r.score >= 75 ? "⚠" : "✗";
    const color = r.score >= 90 ? "\x1b[32m" : r.score >= 75 ? "\x1b[33m" : "\x1b[31m";
    console.log(`  ${color}${icon}\x1b[0m  ${r.page} / ${r.viewport.padEnd(8)}  ${r.score}%  ${r.note || ""}`);
  });
  const low = qaResults.filter(r => r.score < 80);
  if (low.length) {
    console.log("\n  ⚠  Pages to review (score < 80%):");
    low.forEach(r => console.log(`     • ${r.page} (${r.viewport}) — ${r.issues}`));
  }
  console.log(`\n  QA report  : ${outputDir}/qa-report.json`);
  console.log(`  Screenshots: ${outputDir}/screenshots/`);
  console.log("");
}

main().catch(err => {
  const msg = err.message || String(err);
  console.error("\n❌  Pipeline failed:", msg);

  // Hint what to do next based on the error
  if (msg.includes("rate limit") || msg.includes("429")) {
    console.error("\n  This is an Anthropic API rate limit (free/starter plan = 4,000 tokens/min).");
    console.error("  Option 1 — Wait 60s, then resume (nothing is lost):");
    console.error("             RATE_LIMIT_MS=20000 node pipeline.js --from-stage=5");
    console.error("  Option 2 — Upgrade at console.anthropic.com for higher limits\n");
  } else if (msg.includes("authentication failed") || msg.includes("401")) {
    console.error("\n  Fix: Update WP_USER and WP_APP_PASSWORD in your .env file");
    console.error("  Then resume: node pipeline.js --from-stage=6\n");
  } else if (msg.includes("Cannot connect") || msg.includes("ECONNREFUSED") || msg.includes("404")) {
    console.error("\n  Fix: Check WP_URL in your .env — make sure the site is reachable");
    console.error("  Then resume: node pipeline.js --from-stage=6\n");
  } else if (msg.includes("FIGMA_TOKEN") || msg.includes("403")) {
    console.error("\n  Fix: Update FIGMA_TOKEN in your .env");
    console.error("  Then resume: node pipeline.js --figma-url=\"...\" --from-stage=1\n");
  } else if (msg.includes("ANTHROPIC") || msg.includes("API key")) {
    console.error("\n  Fix: Update ANTHROPIC_API_KEY in your .env");
    console.error("  Then resume: node pipeline.js --from-stage=2\n");
  } else {
    console.error("\n  To resume from where it stopped, check which stage failed and run:");
    console.error("  node pipeline.js --from-stage=<N>\n");
  }

  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
