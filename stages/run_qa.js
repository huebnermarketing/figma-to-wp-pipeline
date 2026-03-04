"use strict";
/**
 * Stage 7 — run_qa.js
 * Takes Playwright screenshots of deployed pages and uses Claude Vision
 * to compare them against the original Figma design.
 * Saves: output/screenshots/*.png  + output/qa-report.json
 */

const { chromium } = require("playwright");
const Anthropic    = require("@anthropic-ai/sdk");
const path         = require("path");
const fs           = require("fs");

const client = new Anthropic();

const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "tablet",  width: 768,  height: 1024 },
  { label: "mobile",  width: 390,  height: 844 },
];

/**
 * @param {Array}  pages     - Deployed pages from Stage 6 [{ id, title, url, slug }]
 * @param {Array}  frames    - Original Figma frames from Stage 1
 * @param {string} outputDir
 * @returns {Array} results  - QA result objects
 */
async function runQA(pages, frames, outputDir) {
  const ssDir = path.join(outputDir, "screenshots");
  const results = [];

  // Build Figma frame lookup by slug
  const frameBySlug = {};
  frames.forEach(f => {
    const slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    frameBySlug[slug] = f;
  });

  const browser = await chromium.launch({ headless: true });

  try {
    for (const page of pages) {
      const frame = frameBySlug[page.slug];

      for (const vp of VIEWPORTS) {
        await rateLimit();
        process.stdout.write(`      Checking ${page.slug}/${vp.label}...`);

        const ssPath = path.join(ssDir, `${page.slug}-${vp.label}.png`);
        const screenshot = await captureScreenshot(browser, page.url, vp, ssPath);

        const qaResult = await analyzeWithClaude(screenshot, frame, page, vp);
        results.push(qaResult);

        const scoreStr = `${qaResult.score}%`;
        const icon = qaResult.score >= 90 ? "✓" : qaResult.score >= 75 ? "⚠" : "✗";
        console.log(` ${icon} ${scoreStr}`);
      }
    }
  } finally {
    await browser.close();
  }

  // Save QA report
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      total:      results.length,
      passed:     results.filter(r => r.score >= 90).length,
      warnings:   results.filter(r => r.score >= 75 && r.score < 90).length,
      failed:     results.filter(r => r.score < 75).length,
      avgScore:   Math.round(results.reduce((s, r) => s + r.score, 0) / results.length),
    },
    results,
  };
  fs.writeFileSync(path.join(outputDir, "qa-report.json"), JSON.stringify(report, null, 2));

  return results;
}

async function captureScreenshot(browser, url, viewport, ssPath) {
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    // Wait a beat for fonts + lazy images
    await page.waitForTimeout(1500);
    const buffer = await page.screenshot({ fullPage: viewport.label === "desktop" });
    fs.writeFileSync(ssPath, buffer);
    return buffer.toString("base64");
  } finally {
    await page.close();
  }
}

async function analyzeWithClaude(screenshotBase64, frame, page, viewport) {
  // Build a text description of what the Figma frame should look like
  const frameDesc = frame
    ? `Figma frame "${frame.name}": ${describeChildren(frame)}`
    : `Page "${page.title}" (no Figma frame reference available)`;

  const prompt = `You are a QA engineer comparing a live WordPress page screenshot against a Figma design.

Page: "${page.title}" at ${viewport.label} breakpoint (${viewport.width}×${viewport.height}px)
Expected design: ${frameDesc}

Look at the screenshot and evaluate:
1. Is the overall layout correct and well-structured?
2. Are typography sizes and weights appropriate?
3. Are colors consistent (no white-on-white, dark-on-dark)?
4. Are there any overflow issues or cut-off text?
5. Is the responsive behavior appropriate for ${viewport.label}?

Respond with JSON only:
{
  "score": <0-100 integer: visual fidelity score>,
  "note": "<one-line summary>",
  "issues": "<comma-separated list of specific issues, or 'none'>",
  "recommendations": "<actionable fixes if score < 90>"
}`;

  try {
    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-opus-4-6",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: screenshotBase64 },
          },
          { type: "text", text: prompt },
        ],
      }],
    });

    const rawText = response.content[0].text.trim();
    const cleaned = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "");
    const parsed  = JSON.parse(cleaned);

    return {
      page:            page.slug,
      title:           page.title,
      url:             page.url,
      viewport:        viewport.label,
      score:           parsed.score,
      note:            parsed.note || "",
      issues:          parsed.issues || "none",
      recommendations: parsed.recommendations || "",
      screenshotPath:  `screenshots/${page.slug}-${viewport.label}.png`,
    };
  } catch (err) {
    // If vision call fails, return a partial result
    return {
      page:     page.slug,
      title:    page.title,
      url:      page.url,
      viewport: viewport.label,
      score:    0,
      note:     `QA analysis failed: ${err.message}`,
      issues:   "Claude Vision call failed",
    };
  }
}

function describeChildren(frame) {
  if (!frame?.children?.length) return "no children available";
  return frame.children
    .slice(0, 6)
    .map(c => `${c.name}(${c.type})`)
    .join(", ");
}

function rateLimit() {
  const ms = parseInt(process.env.RATE_LIMIT_MS || "500", 10);
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = runQA;
