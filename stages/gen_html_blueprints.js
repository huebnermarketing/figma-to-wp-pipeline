"use strict";
/**
 * Stage 4 — gen_html_blueprints.js
 * Uses Claude AI to convert Figma frames → semantic HTML blueprints.
 * Saves: output/blueprints/{pageName}.html
 */

const Anthropic = require("@anthropic-ai/sdk");
const path      = require("path");
const fs        = require("fs");

const client = new Anthropic();

/**
 * @param {Array}  frames    - Figma frames from Stage 1
 * @param {object} tokens    - Design tokens from Stage 2
 * @param {string} outputDir
 * @returns {object} blueprints - { [frameName]: htmlString }
 */
async function genHtmlBlueprints(frames, tokens, outputDir) {
  const blueprints = {};
  const bpDir = path.join(outputDir, "blueprints");

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const name  = sanitizeName(frame.name);

    if (i > 0) await rateLimit();
    process.stdout.write(`      Generating HTML for: ${frame.name}...`);

    const html = await generateHtmlForFrame(frame, tokens);
    blueprints[name] = html;

    const outPath = path.join(bpDir, `${name}.html`);
    fs.writeFileSync(outPath, html);
    console.log(` ✓`);
  }

  return blueprints;
}

async function generateHtmlForFrame(frame, tokens) {
  // Build a compact frame description for Claude
  const frameDesc = describeFrame(frame);

  const prompt = `You are a frontend developer converting a Figma frame into semantic HTML.

Frame: "${frame.name}"
Dimensions: ${frame.absoluteBoundingBox?.width || 1440}px × ${frame.absoluteBoundingBox?.height || 900}px

Frame structure:
${JSON.stringify(frameDesc, null, 2)}

Design tokens:
- Primary color: ${tokens.colors?.primary || "#000"}
- Background: ${tokens.colors?.background || "#fff"}
- Heading font: ${tokens.typography?.headingFont || "sans-serif"}
- Body font: ${tokens.typography?.bodyFont || "sans-serif"}
- Container max-width: ${tokens.containerMaxWidth || 1200}px

Generate complete, semantic HTML for this page. Requirements:
1. Use semantic HTML5 tags: <header>, <nav>, <main>, <section>, <footer>
2. Use BEM class names (e.g. .hero__title, .card__body)
3. Infer sections from the Figma structure (hero, features, testimonials, CTA, etc.)
4. Include placeholder text that describes the content (e.g. "Main headline goes here")
5. Use <img src="placeholder.jpg" alt="description"> for images
6. Include an inline <style> block with basic CSS using the design tokens
7. Make it a complete HTML document with <!DOCTYPE html>

Return ONLY the HTML, no explanation.`;

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || "claude-opus-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text.trim();
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
