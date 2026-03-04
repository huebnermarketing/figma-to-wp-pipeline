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
  const prompt = `You are an Elementor WordPress expert. Convert this HTML page into an Elementor page template JSON.

Page name: "${name}"
Design tokens:
- Primary: ${tokens.colors?.primary || "#000"}
- Background: ${tokens.colors?.background || "#fff"}
- Text: ${tokens.colors?.text || "#333"}
- Heading font: ${tokens.typography?.headingFont || "sans-serif"}
- Body font: ${tokens.typography?.bodyFont || "sans-serif"}
- H1 size: ${tokens.typography?.h1?.size || 48}px
- Body size: ${tokens.typography?.body?.size || 16}px
- Container width: ${tokens.containerMaxWidth || 1200}px

HTML blueprint:
${html.slice(0, 8000)}

Generate an Elementor page data JSON array. This is the format stored in the _elementor_data post meta field.

Rules:
1. Each element needs a unique "id" (8-char hex string like "a1b2c3d4")
2. Top-level elements must use "elType": "container" (Elementor Flexbox Container)
3. Widgets use "elType": "widget" with a "widgetType" field
4. Common widget types: heading, text-editor, image, button, divider, spacer, html
5. Each widget/container needs "settings": {} and "elements": []
6. For heading widget: settings needs "title", "header_size" (h1-h6), "align"
7. For text-editor widget: settings needs "editor" (HTML content)
8. For button widget: settings needs "text", "link", "button_type"
9. For image widget: settings needs "image" (use {"url":"","id":""} placeholder)
10. Add typography and color settings to match the design tokens

Return ONLY a valid JSON array of Elementor container/widget objects. No markdown, no explanation.
Example minimal structure:
[
  {
    "id": "a1b2c3d4",
    "elType": "container",
    "isInner": false,
    "settings": {
      "content_width": "full",
      "background_color": "#ffffff",
      "padding": {"top":"80","right":"0","bottom":"80","left":"0","unit":"px","isLinked":false}
    },
    "elements": [
      {
        "id": "b2c3d4e5",
        "elType": "container",
        "isInner": true,
        "settings": { "content_width": "boxed" },
        "elements": [
          {
            "id": "c3d4e5f6",
            "elType": "widget",
            "widgetType": "heading",
            "settings": {
              "title": "Page Heading",
              "header_size": "h1",
              "align": "center",
              "title_color": "#1a1a1a"
            },
            "elements": []
          }
        ]
      }
    ]
  }
]`;

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || "claude-opus-4-6",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.content[0].text.trim();
  let templateJson;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "");
    templateJson = JSON.parse(cleaned);
  } catch {
    throw new Error(`Claude returned invalid JSON for template "${name}".\nRaw: ${rawText.slice(0, 300)}`);
  }

  // Ensure all IDs are unique
  templateJson = ensureUniqueIds(templateJson);

  return templateJson;
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
