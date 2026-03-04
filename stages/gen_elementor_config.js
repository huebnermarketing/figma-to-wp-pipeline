"use strict";
/**
 * Stage 3 — gen_elementor_config.js
 * Uses Claude AI to convert design tokens → Elementor global settings JSON.
 * Saves: output/elementor-config.json
 */

const claudeCall = require("../utils/claude_call");
const path       = require("path");
const fs         = require("fs");

/**
 * @param {object} tokens    - Design tokens from Stage 2
 * @param {string} outputDir
 * @returns {object} config  - Elementor global settings object
 */
async function genElementorConfig(tokens, outputDir) {
  await rateLimit();

  const prompt = `You are an Elementor WordPress expert. Convert these design tokens into Elementor global settings.

Design tokens:
${JSON.stringify(tokens, null, 2)}

Return a JSON object with this exact structure (this will be written to the WordPress database via wp_update_option):
{
  "system_colors": [
    { "id": "primary",    "title": "Primary",    "color": "#hex" },
    { "id": "secondary",  "title": "Secondary",  "color": "#hex" },
    { "id": "text",       "title": "Text",       "color": "#hex" },
    { "id": "accent",     "title": "Accent",     "color": "#hex" },
    { "id": "background", "title": "Background", "color": "#hex" }
  ],
  "system_typography": [
    {
      "id": "primary",
      "title": "Primary",
      "typography_font_family": "Font Name",
      "typography_font_size": { "unit": "px", "size": 16 },
      "typography_font_weight": "400"
    },
    {
      "id": "secondary",
      "title": "Secondary",
      "typography_font_family": "Font Name",
      "typography_font_size": { "unit": "px", "size": 14 },
      "typography_font_weight": "400"
    },
    {
      "id": "text",
      "title": "Text",
      "typography_font_family": "Font Name",
      "typography_font_size": { "unit": "px", "size": 16 },
      "typography_font_weight": "400"
    },
    {
      "id": "accent",
      "title": "Accent",
      "typography_font_family": "Font Name",
      "typography_font_size": { "unit": "px", "size": 20 },
      "typography_font_weight": "600"
    }
  ],
  "container_width": { "unit": "px", "size": 1200 },
  "space_between_widgets": 20,
  "stretched_section_container": "body"
}

Use the font families and sizes from the design tokens. Return ONLY valid JSON.`;

  const response = await claudeCall({
    model:      process.env.CLAUDE_MODEL || "claude-opus-4-6",
    max_tokens: 2048,
    messages:   [{ role: "user", content: prompt }],
  }, "gen_elementor_config");

  const rawText = response.content[0].text.trim();
  let config;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "");
    config = JSON.parse(cleaned);
  } catch {
    throw new Error(`Claude returned invalid JSON for Elementor config.\nRaw: ${rawText.slice(0, 500)}`);
  }

  const outPath = path.join(outputDir, "elementor-config.json");
  fs.writeFileSync(outPath, JSON.stringify(config, null, 2));

  return config;
}

function rateLimit() {
  const ms = parseInt(process.env.RATE_LIMIT_MS || "500", 10);
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = genElementorConfig;
