"use strict";
/**
 * Stage 2 — extract_tokens.js
 * Uses Claude AI to extract design tokens from the Figma document tree.
 * Saves: output/design-tokens.json
 */

const Anthropic = require("@anthropic-ai/sdk");
const path      = require("path");
const fs        = require("fs");

const client = new Anthropic();

/**
 * @param {object} figmaData - Output from Stage 1
 * @param {string} outputDir
 * @returns {object} tokens - { colors, typography, spacing, borderRadius, shadows }
 */
async function extractTokens(figmaData, outputDir) {
  // Build a compact summary of the Figma document for Claude
  // (full document can be very large — we extract the essentials)
  const summary = buildFigmaSummary(figmaData);

  const prompt = `You are a design system expert. Analyze this Figma document summary and extract all design tokens.

Figma Document Summary:
${JSON.stringify(summary, null, 2)}

Extract and return a JSON object with exactly these keys:
{
  "colors": {
    "primary":    "#hex",
    "secondary":  "#hex",
    "accent":     "#hex",
    "background": "#hex",
    "surface":    "#hex",
    "text":       "#hex",
    "textLight":  "#hex",
    "border":     "#hex",
    "error":      "#hex",
    "success":    "#hex"
  },
  "typography": {
    "headingFont":  "Font Family Name",
    "bodyFont":     "Font Family Name",
    "h1":  { "size": 48, "weight": 700, "lineHeight": 1.2 },
    "h2":  { "size": 36, "weight": 700, "lineHeight": 1.3 },
    "h3":  { "size": 28, "weight": 600, "lineHeight": 1.4 },
    "h4":  { "size": 22, "weight": 600, "lineHeight": 1.4 },
    "body": { "size": 16, "weight": 400, "lineHeight": 1.6 },
    "small": { "size": 14, "weight": 400, "lineHeight": 1.5 }
  },
  "spacing": [4, 8, 12, 16, 24, 32, 48, 64, 80, 96],
  "borderRadius": {
    "sm": 4,
    "md": 8,
    "lg": 16,
    "full": 9999
  },
  "shadows": {
    "sm": "0 1px 3px rgba(0,0,0,0.12)",
    "md": "0 4px 12px rgba(0,0,0,0.15)",
    "lg": "0 8px 32px rgba(0,0,0,0.20)"
  },
  "containerMaxWidth": 1200,
  "sectionPadding": { "vertical": 80, "horizontal": 0 }
}

Infer values from the actual Figma data. If a value is not found, use a sensible default.
Return ONLY the JSON object, no explanation or markdown.`;

  let response;
  try {
    response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-opus-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    throw new Error(`Claude API error in extract_tokens: ${err.message}`);
  }

  const rawText = response.content[0].text.trim();
  let tokens;
  try {
    // Strip markdown code fences if present
    const cleaned = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "");
    tokens = JSON.parse(cleaned);
  } catch {
    throw new Error(`Claude returned invalid JSON for design tokens.\nRaw response:\n${rawText.slice(0, 500)}`);
  }

  const outPath = path.join(outputDir, "design-tokens.json");
  fs.writeFileSync(outPath, JSON.stringify(tokens, null, 2));

  return tokens;
}

/**
 * Build a compact Figma summary that fits in a Claude prompt.
 * Extracts text styles, fill colors, and font usage from the node tree.
 */
function buildFigmaSummary(figmaData) {
  const { styles, frames, document: doc } = figmaData;

  // Collect unique fills and fonts by walking the tree
  const colors = new Set();
  const fonts  = new Set();

  function walk(node) {
    if (!node) return;

    // Fill colors
    (node.fills || []).forEach(fill => {
      if (fill.type === "SOLID" && fill.color) {
        const { r, g, b } = fill.color;
        colors.add(rgbToHex(r, g, b));
      }
    });

    // Font styles
    if (node.style?.fontFamily) {
      fonts.add({
        family: node.style.fontFamily,
        size:   node.style.fontSize,
        weight: node.style.fontWeight,
      });
    }

    (node.children || []).forEach(walk);
  }

  // Only walk first 3 frames to keep prompt size manageable
  (frames || []).slice(0, 3).forEach(walk);

  return {
    fileName:  figmaData.fileName,
    frameNames: frames.map(f => f.name),
    uniqueColors: Array.from(colors).slice(0, 20),
    uniqueFonts:  Array.from(fonts).slice(0, 10),
    namedStyles:  Object.values(styles || {}).slice(0, 20).map(s => ({
      name: s.name, type: s.styleType,
    })),
    // Include bounding boxes from first frame for layout info
    firstFrameSize: frames[0] ? {
      width:  frames[0].absoluteBoundingBox?.width,
      height: frames[0].absoluteBoundingBox?.height,
    } : null,
  };
}

function rgbToHex(r, g, b) {
  const toHex = v => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

module.exports = extractTokens;
