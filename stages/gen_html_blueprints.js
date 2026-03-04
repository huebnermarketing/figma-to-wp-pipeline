"use strict";
/**
 * Stage 4 — gen_html_blueprints.js
 * Uses Claude AI to convert Figma frames → semantic HTML blueprints.
 * Saves: output/blueprints/{pageName}.html
 */

const claudeCall = require("../utils/claude_call");
const path       = require("path");
const fs         = require("fs");

/**
 * @param {Array}  frames    - Figma frames from Stage 1
 * @param {object} tokens    - Design tokens from Stage 2
 * @param {string} outputDir
 * @param {object} imageMap  - { nodeId: "https://..." } from Stage 1 image export
 * @returns {object} blueprints - { [frameName]: htmlString }
 */
async function genHtmlBlueprints(frames, tokens, outputDir, imageMap = {}) {
  const blueprints = {};
  const bpDir = path.join(outputDir, "blueprints");

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const name  = sanitizeName(frame.name);

    if (i > 0) await rateLimit();
    process.stdout.write(`      Generating HTML for: ${frame.name}...`);

    const html = await generateHtmlForFrame(frame, tokens, imageMap);
    blueprints[name] = html;

    const outPath = path.join(bpDir, `${name}.html`);
    fs.writeFileSync(outPath, html);
    console.log(` ✓`);
  }

  return blueprints;
}

async function generateHtmlForFrame(frame, tokens, imageMap = {}) {
  // Build a compact frame description for Claude
  const frameDesc = describeFrame(frame);

  // Collect real image URLs for nodes inside this frame
  const frameImages = collectFrameImages(frame, imageMap);
  const hasRealImages = Object.keys(frameImages).length > 0;

  const imageInstructions = hasRealImages
    ? `REAL IMAGE ASSETS (use these exact URLs in <img> src attributes — do NOT use placeholders):
${Object.entries(frameImages).map(([name, url]) => `  - "${name}": ${url}`).join("\n")}`
    : `No image assets were exported. Use descriptive placeholder text in alt attributes and <img src="https://placehold.co/800x500/eeeeee/999999?text=Image" alt="description">.`;

  const prompt = `You are an expert frontend developer converting a Figma frame into a pixel-faithful semantic HTML page.

Frame: "${frame.name}"
Dimensions: ${frame.absoluteBoundingBox?.width || 1440}px × ${frame.absoluteBoundingBox?.height || 900}px

Frame structure:
${JSON.stringify(frameDesc, null, 2)}

Design tokens:
- Primary color: ${tokens.colors?.primary || "#000"}
- Accent color: ${tokens.colors?.accent || tokens.colors?.secondary || "#f37022"}
- Background: ${tokens.colors?.background || "#fff"}
- Text color: ${tokens.colors?.text || "#333"}
- Heading font: ${tokens.typography?.headingFont || "sans-serif"}
- Body font: ${tokens.typography?.bodyFont || "sans-serif"}
- Container max-width: ${tokens.containerMaxWidth || 1200}px

${imageInstructions}

Generate a complete, faithful HTML document for this page. Requirements:
1. Use semantic HTML5 tags: <header>, <nav>, <main>, <section>, <footer>
2. Use BEM class names (e.g. .hero__title, .card__body)
3. Match the Figma layout as closely as possible — infer section names, order, and visual hierarchy from the frame structure
4. For images: use the REAL image URLs provided above (matched by node name). Only fall back to placeholders if no real URL exists for that element
5. Include an inline <style> block with CSS that:
   - Uses the design tokens for colors and fonts
   - Implements flexbox/grid layouts matching the Figma structure
   - Includes hover states for interactive elements
   - Is fully responsive (mobile breakpoint at 768px)
6. Make it a complete HTML document with <!DOCTYPE html>
7. Do NOT include any JavaScript

Return ONLY the HTML, no explanation, no markdown fences.`;

  const response = await claudeCall({
    model:      process.env.CLAUDE_MODEL || "claude-opus-4-6",
    max_tokens: 4096,
    messages:   [{ role: "user", content: prompt }],
  }, `gen_html:${frame.name}`);

  return response.content[0].text.trim();
}

/**
 * Walk a frame's node tree and build a map of { nodeName: imageUrl }
 * for every node that has a real image URL from the Figma export.
 */
function collectFrameImages(frame, imageMap) {
  const refs = {};
  function walk(node) {
    if (!node) return;
    if (imageMap[node.id]) {
      // Use node name as key, falling back to node ID
      const key = node.name || node.id;
      refs[key] = imageMap[node.id];
    }
    (node.children || []).forEach(walk);
  }
  walk(frame);
  return refs;
}

/**
 * Build a compact description of a frame for the Claude prompt.
 */
function describeFrame(frame) {
  const desc = { name: frame.name, type: frame.type, children: [] };

  function walk(node, depth) {
    if (depth > 3) return null; // limit depth for prompt size
    const item = {
      name: node.name,
      type: node.type,
      text: node.characters || undefined,
    };
    if (node.children && depth < 3) {
      item.children = node.children
        .slice(0, 8) // limit children per node
        .map(c => walk(c, depth + 1))
        .filter(Boolean);
    }
    return item;
  }

  desc.children = (frame.children || [])
    .slice(0, 12)
    .map(c => walk(c, 1))
    .filter(Boolean);

  return desc;
}

function sanitizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "page";
}

function rateLimit() {
  const ms = parseInt(process.env.RATE_LIMIT_MS || "500", 10);
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = genHtmlBlueprints;
