#!/usr/bin/env node
"use strict";
/**
 * pipeline.js — Master Orchestrator
 * Figma In. WordPress Out.
 *
 * Usage:
 *   node pipeline.js --figma-url="https://www.figma.com/file/ABC123/MyWebsite"
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

// ─── Validate environment ────────────────────────────────────────────────────
function validateEnv() {
  const required = {
    FIGMA_TOKEN:       "Figma Personal Access Token",
    ANTHROPIC_API_KEY: "Anthropic API key",
    WP_URL:            "WordPress site URL",
    WP_USER:           "WordPress admin username",
    WP_APP_PASSWORD:   "WordPress Application Password",
  };
  const missing = Object.entries(required)
    .filter(([k]) => !process.env[k])
    .map(([k, label]) => `  • ${k} — ${label}`);
  if (missing.length) {
    console.error("\n❌  Missing required environment variables:\n" + missing.join("\n"));
    console.error("\n  Copy .env.example → .env and fill in the values.\n");
    process.exit(1);
  }
}

// ─── Output directory ────────────────────────────────────────────────────────
function ensureOutputDir() {
  const dir = path.resolve(process.env.OUTPUT_DIR || "./output");
  ["", "blueprints", "templates", "screenshots"].forEach(sub => {
    const p = path.join(dir, sub);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
  return dir;
}

// ─── Pretty logger ────────────────────────────────────────────────────────────
function log(stage, msg) {
  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  console.log(`[${ts}] ${stage}  ${msg}`);
}

function header(text) {
  console.log("\n" + "─".repeat(60));
  console.log("  " + text);
  console.log("─".repeat(60));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const figmaUrl = args["figma-url"] || args["figma_url"] || args.f;

  if (!figmaUrl) {
    console.error('\nUsage: node pipeline.js --figma-url="https://figma.com/file/..."\n');
    process.exit(1);
  }

  validateEnv();
  const outputDir = ensureOutputDir();
  const startTime = Date.now();

  header("🚀  Figma → WordPress Elementor Pipeline");
  console.log(`  Figma URL : ${figmaUrl}`);
  console.log(`  WP Site   : ${process.env.WP_URL}`);
  console.log(`  Output    : ${outputDir}`);
  console.log(`  Model     : ${process.env.CLAUDE_MODEL || "claude-opus-4-6"}`);

  // ── Stage 1: Fetch Figma ───────────────────────────────────────────────────
  console.log("\n[1/7] Fetching Figma file...");
  const t1 = Date.now();
  const figmaData = await fetchFigma(figmaUrl, outputDir);
  log("1/7 ✓", `Fetched in ${((Date.now() - t1) / 1000).toFixed(1)}s  — ${figmaData.frames.length} frames found`);
  figmaData.frames.forEach(f => console.log(`      · ${f.name} (${f.id})`));

  // ── Stage 2: Extract Design Tokens ────────────────────────────────────────
  console.log("\n[2/7] Extracting design tokens with Claude...");
  const t2 = Date.now();
  const tokens = await extractTokens(figmaData, outputDir);
  log("2/7 ✓", `Extracted in ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  console.log(`      · Colors: ${Object.keys(tokens.colors || {}).length}`);
  console.log(`      · Type scales: ${Object.keys(tokens.typography || {}).length}`);
  console.log(`      · Spacing values: ${(tokens.spacing || []).length}`);

  // ── Stage 3: Generate Elementor Config ────────────────────────────────────
  console.log("\n[3/7] Generating Elementor global config with Claude...");
  const t3 = Date.now();
  const config = await genElementorConfig(tokens, outputDir);
  log("3/7 ✓", `Generated in ${((Date.now() - t3) / 1000).toFixed(1)}s  — elementor-config.json written`);

  // ── Stage 4: Generate HTML Blueprints ────────────────────────────────────
  console.log("\n[4/7] Generating HTML blueprints with Claude...");
  const t4 = Date.now();
  const blueprints = await genHtmlBlueprints(figmaData.frames, tokens, outputDir);
  const bpCount = Object.keys(blueprints).length;
  log("4/7 ✓", `Generated ${bpCount} blueprint(s) in ${((Date.now() - t4) / 1000).toFixed(1)}s`);
  Object.keys(blueprints).forEach(name => console.log(`      · ${name}.html`));

  // ── Stage 5: Generate Elementor Templates ─────────────────────────────────
  console.log("\n[5/7] Converting blueprints to Elementor templates with Claude...");
  const t5 = Date.now();
  const templates = await genElementorTemplates(blueprints, tokens, outputDir);
  log("5/7 ✓", `Generated ${Object.keys(templates).length} template(s) in ${((Date.now() - t5) / 1000).toFixed(1)}s`);

  // ── Stage 6: Deploy to WordPress ──────────────────────────────────────────
  console.log("\n[6/7] Deploying to WordPress...");
  const t6 = Date.now();
  const pages = await deployToWordPress(config, templates, outputDir);
  log("6/7 ✓", `Deployed ${pages.length} page(s) in ${((Date.now() - t6) / 1000).toFixed(1)}s`);
  pages.forEach(p => console.log(`      · ${p.title}  →  ${p.url}`));

  // ── Stage 7: Automated QA ─────────────────────────────────────────────────
  console.log("\n[7/7] Running automated QA with Playwright + Claude Vision...");
  const t7 = Date.now();
  const qaResults = await runQA(pages, figmaData.frames, outputDir);
  log("7/7 ✓", `QA complete in ${((Date.now() - t7) / 1000).toFixed(1)}s`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalSec = ((Date.now() - startTime) / 1000).toFixed(0);
  header(`✅  Pipeline Complete — ${totalSec}s total`);

  console.log("\n  QA Results:");
  qaResults.forEach(r => {
    const icon = r.score >= 90 ? "✓" : r.score >= 75 ? "⚠" : "✗";
    const color = r.score >= 90 ? "\x1b[32m" : r.score >= 75 ? "\x1b[33m" : "\x1b[31m";
    console.log(`  ${color}${icon}\x1b[0m  ${r.page} / ${r.viewport.padEnd(8)}  ${r.score}%  ${r.note || ""}`);
  });

  const lowFidelity = qaResults.filter(r => r.score < 80);
  if (lowFidelity.length) {
    console.log("\n  ⚠  Low-fidelity pages — review screenshots and re-run if needed:");
    lowFidelity.forEach(r => console.log(`     • ${r.page} (${r.viewport}) — ${r.issues}`));
  }

  console.log(`\n  Output files: ${outputDir}/`);
  console.log(`  QA report  : ${outputDir}/qa-report.json`);
  console.log(`  Screenshots: ${outputDir}/screenshots/`);
  console.log("");
}

main().catch(err => {
  console.error("\n❌  Pipeline failed:", err.message || err);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
