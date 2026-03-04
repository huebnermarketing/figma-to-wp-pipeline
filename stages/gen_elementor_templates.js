"use strict";
/**
 * Stage 5 — gen_elementor_templates.js
 * Uses Claude AI to convert HTML blueprints → Elementor page template JSON.
 * Saves: output/templates/{pageName}.json
 */

const Anthropic = require("@anthropic-ai/sdk");
const path      = require("path");
const fs        = require("fs");
const crypto    = require("crypto");

const client = new Anthropic();

/**
 * @param {object} blueprints - { [name]: htmlString } from Stage 4
 * @param {object} tokens     - Design tokens from Stage 2
 * @param {string} outputDir
 * @returns {object} templates - { [name]: elementorJson }
 */
async function genElementorTemplates(blueprints, tokens, outputDir) {
  const templates = {};
  const tplDir = path.join(outputDir, "templates");
  const entries = Object.entries(blueprints);

  for (let i = 0; i < entries.length; i++) {
    const [name, html] = entries[i];
    if (i > 0) await rateLimit();
    process.stdout.write(`      Generating Elementor template: ${name}...`);

    const template = await generateTemplate(name, html, tokens);
    templates[name] = template;

    const outPath = path.join(tplDir, `${name}.json`);
    fs.writeFileSync(outPath, JSON.stringify(template, null, 2));
    console.log(` ✓`);
  }

  return templates;
}

async function generateTemplate(name, html, tokens) {
  // First attempt: full detail with high token limit
  try {
    return await attemptGenerate(name, html, tokens, {
      htmlLimit: 6000,
      maxTokens: 32768,
      detailed: true,
    });
  } catch (err) {
    if (!err.message.includes("invalid JSON") && !err.message.includes("truncated")) throw err;
    console.log(`\n      ↻ Retrying with simplified prompt...`);
  }

  // Second attempt: section-by-section (split HTML, build fewer containers)
  try {
    return await attemptGenerate(name, html, tokens, {
      htmlLimit: 3000,
      maxTokens: 16384,
      detailed: false,
    });
  } catch (err) {
    if (!err.message.includes("invalid JSON") && !err.message.includes("truncated")) throw err;
    console.log(`\n      ↻ Retrying with minimal skeleton...`);
  }

  // Final fallback: minimal skeleton that Elementor can open
  return buildFallbackTemplate(name, tokens);
}

async function attemptGenerate(name, html, tokens, { htmlLimit, maxTokens, detailed }) {
  const detailNote = detailed
    ? "Be thorough — include all major sections from the HTML."
    : "Keep it concise — use one container per major section, minimal nested elements.";

  const prompt = `You are an Elementor WordPress expert. Convert this HTML into an Elementor page template JSON array.

Page: "${name}"
Colors: primary=${tokens.colors?.primary || "#333"}, bg=${tokens.colors?.background || "#fff"}, text=${tokens.colors?.text || "#333"}
Fonts: heading="${tokens.typography?.headingFont || "sans-serif"}", body="${tokens.typography?.bodyFont || "sans-serif"}"
Container max-width: ${tokens.containerMaxWidth || 1200}px

HTML (truncated for brevity):
${html.slice(0, htmlLimit)}

Rules (CRITICAL — follow exactly):
1. Return ONLY a raw JSON array — no markdown fences, no explanation, no trailing text
2. The array must be complete and valid — every [ must have a matching ]
3. Each element: { "id": "<8-char hex>", "elType": "container"|"widget", "settings": {}, "elements": [] }
4. Widgets also need "widgetType": "heading"|"text-editor"|"image"|"button"|"spacer"|"divider"
5. Keep settings minimal — only include properties that have real values
6. ${detailNote}
7. STOP before the token limit — close all open arrays/objects cleanly

Output the JSON array now:`;

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || "claude-opus-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText  = response.content[0].text.trim();
  const stopReason = response.stop_reason;

  // Strip markdown fences
  let cleaned = rawText
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  // If response was cut off (stop_reason === "max_tokens"), try to repair it
  if (stopReason === "max_tokens") {
    cleaned = repairTruncatedJson(cleaned);
  }

  let templateJson;
  try {
    templateJson = JSON.parse(cleaned);
  } catch {
    throw new Error(`invalid JSON for template "${name}" (stop_reason: ${stopReason})`);
  }

  if (!Array.isArray(templateJson)) {
    throw new Error(`Claude returned an object instead of an array for "${name}"`);
  }

  return ensureUniqueIds(templateJson);
}

/**
 * Attempt to repair a JSON array that was cut off mid-stream.
 * Finds the last fully-closed top-level element and closes the array after it.
 */
function repairTruncatedJson(text) {
  // Find the last position of a complete top-level object: ends with "}," or "}"
  // Strategy: find the last "}" at depth 0 in the array
  let depth = 0;
  let lastValidEnd = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      // A closing "}" at depth 1 means we just closed a top-level array element
      if (depth === 1 && ch === "}") lastValidEnd = i;
    }
  }

  if (lastValidEnd > 0) {
    // Close the array after the last valid top-level object
    return text.slice(0, lastValidEnd + 1) + "\n]";
  }

  // Can't repair — return as-is and let JSON.parse throw
  return text;
}

/**
 * Minimal fallback template so the pipeline doesn't completely fail.
 * Produces a simple page skeleton Elementor can open and edit.
 */
function buildFallbackTemplate(name, tokens) {
  const pageTitle = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const primary   = (tokens.colors?.primary   || "#333333").replace("#", "");
  const bg        = (tokens.colors?.background || "#ffffff").replace("#", "");
  const textColor = (tokens.colors?.text       || "#333333").replace("#", "");

  console.log(`\n      ⚠ Using fallback skeleton for "${name}" — edit in Elementor`);

  return ensureUniqueIds([
    {
      id: "fb000001", elType: "container", isInner: false,
      settings: { content_width: "full", background_color: `#${bg}`, padding: { top: "80", right: "0", bottom: "80", left: "0", unit: "px", isLinked: false } },
      elements: [
        {
          id: "fb000002", elType: "container", isInner: true,
          settings: { content_width: "boxed" },
          elements: [
            {
              id: "fb000003", elType: "widget", widgetType: "heading",
              settings: { title: `${pageTitle} — Edit This Page in Elementor`, header_size: "h1", align: "center", title_color: `#${primary}` },
              elements: [],
            },
            {
              id: "fb000004", elType: "widget", widgetType: "text-editor",
              settings: { editor: `<p style="color:#${textColor}">This page was auto-generated by the Figma pipeline. The Elementor template could not be fully generated automatically for this page. Open this page in Elementor and rebuild the sections using your design file as reference.</p>` },
              elements: [],
            },
          ],
        },
      ],
    },
  ]);
}

/**
 * Walk the template and replace any duplicate IDs with fresh ones.
 */
function ensureUniqueIds(elements, seen = new Set()) {
  return (elements || []).map(el => {
    if (!el.id || seen.has(el.id)) {
      el.id = crypto.randomBytes(4).toString("hex");
    }
    seen.add(el.id);
    if (el.elements?.length) {
      el.elements = ensureUniqueIds(el.elements, seen);
    }
    return el;
  });
}

function rateLimit() {
  const ms = parseInt(process.env.RATE_LIMIT_MS || "500", 10);
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = genElementorTemplates;
