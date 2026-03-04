"use strict";
/**
 * Stage 1 — fetch_figma.js
 * Fetches the full Figma file via REST API.
 * Also exports all image assets from the design.
 * Saves: output/figma-raw.json, output/figma-images.json
 */

const axios = require("axios");
const path  = require("path");
const fs    = require("fs");

/**
 * @param {string} figmaUrl  - Full Figma file URL
 * @param {string} outputDir - Path to output directory
 * @returns {{ fileId, frames, styles, components, rawDocument }}
 */
async function fetchFigma(figmaUrl, outputDir) {
  // Extract file ID from URL
  // Supports: figma.com/file/ID/name  and  figma.com/design/ID/name
  const match = figmaUrl.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  if (!match) {
    throw new Error(`Could not extract Figma file ID from URL: ${figmaUrl}`);
  }
  const fileId = match[1];

  // Fetch file from Figma REST API
  let response;
  try {
    response = await axios.get(`https://api.figma.com/v1/files/${fileId}`, {
      headers: { "X-Figma-Token": process.env.FIGMA_TOKEN },
      timeout: 60000,
    });
  } catch (err) {
    if (err.response?.status === 403) {
      throw new Error("Figma API returned 403 Forbidden. Check your FIGMA_TOKEN is valid and has access to this file.");
    }
    if (err.response?.status === 404) {
      throw new Error("Figma file not found. Check the URL and ensure the file is accessible to your token.");
    }
    throw new Error(`Figma API error: ${err.message}`);
  }

  const { document, styles, components, name: fileName } = response.data;

  // Extract top-level frames (each frame = one page/section)
  const frames = extractTopLevelFrames(document);

  if (frames.length === 0) {
    throw new Error("No top-level frames found in the Figma file. Make sure your Figma file has at least one Frame (not just groups).");
  }

  // ── Export image assets from Figma ──────────────────────────────────────────
  const imageNodeIds = collectImageNodeIds(document);
  let imageMap = {};

  if (imageNodeIds.length > 0) {
    process.stdout.write(`      Exporting ${imageNodeIds.length} image asset(s) from Figma...`);
    imageMap = await exportFigmaImages(fileId, imageNodeIds);
    console.log(` ✓  (${Object.keys(imageMap).length} URLs resolved)`);
  }

  // Also export each top-level frame as a full PNG for QA reference
  const frameIds = frames.map(f => f.id);
  let framePreviews = {};
  if (frameIds.length > 0) {
    process.stdout.write(`      Exporting ${frameIds.length} frame preview(s)...`);
    framePreviews = await exportFigmaImages(fileId, frameIds, { scale: 1 });
    console.log(` ✓`);
  }

  // Save image map for Stage 4
  const imagesPath = path.join(outputDir, "figma-images.json");
  fs.writeFileSync(imagesPath, JSON.stringify({ imageMap, framePreviews }, null, 2));

  // Save raw data for debugging / subsequent stages
  const rawPath = path.join(outputDir, "figma-raw.json");
  fs.writeFileSync(rawPath, JSON.stringify({
    fileId,
    fileName,
    frames: frames.map(f => ({ id: f.id, name: f.name })),
    styles,
    components: Object.keys(components || {}).length,
    document,
  }, null, 2));

  return {
    fileId,
    fileName,
    frames,
    styles:        styles || {},
    document,
    imageMap,
    framePreviews,
  };
}

/**
 * Walk the full document tree and collect IDs of every node that
 * has an IMAGE fill — these are the photos, illustrations, and
 * background images that need to be fetched from Figma's image API.
 */
function collectImageNodeIds(document) {
  const ids = new Set();

  function walk(node) {
    if (!node) return;
    if (Array.isArray(node.fills)) {
      if (node.fills.some(f => f.type === "IMAGE" && f.visible !== false)) {
        ids.add(node.id);
      }
    }
    (node.children || []).forEach(walk);
  }

  walk(document);
  return Array.from(ids);
}

/**
 * Call the Figma Images API to get CDN URLs for a list of node IDs.
 * Batches into chunks of 100 (Figma API limit).
 * Returns { nodeId: "https://..." } map.
 */
async function exportFigmaImages(fileId, nodeIds, options = {}) {
  const format = options.format || "png";
  const scale  = options.scale  || 2;
  const imageMap = {};

  // Chunk into batches of 100
  for (let i = 0; i < nodeIds.length; i += 100) {
    const batch = nodeIds.slice(i, i + 100);
    try {
      const res = await axios.get(`https://api.figma.com/v1/images/${fileId}`, {
        headers: { "X-Figma-Token": process.env.FIGMA_TOKEN },
        params:  { ids: batch.join(","), format, scale },
        timeout: 60000,
      });
      if (res.data?.images) {
        Object.assign(imageMap, res.data.images);
      }
    } catch (err) {
      // Non-fatal — pipeline continues, images fall back to placeholders
      console.warn(`\n      ⚠  Image export batch failed: ${err.message}`);
    }
  }

  return imageMap;
}

/**
 * Walk the document tree and collect all top-level Frame nodes.
 * In Figma: document → pages (CANVAS) → frames (FRAME)
 */
function extractTopLevelFrames(document) {
  const frames = [];

  function walk(node) {
    if (!node) return;
    // Top-level frames sit directly on a CANVAS page
    if (node.type === "CANVAS") {
      (node.children || []).forEach(child => {
        if (child.type === "FRAME" || child.type === "COMPONENT") {
          frames.push(child);
        }
      });
    } else {
      (node.children || []).forEach(walk);
    }
  }

  walk(document);
  return frames;
}

module.exports = fetchFigma;
