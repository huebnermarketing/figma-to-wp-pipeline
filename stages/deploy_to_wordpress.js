"use strict";
/**
 * Stage 6 — deploy_to_wordpress.js
 * Deploys Elementor config + page templates to WordPress via REST API.
 *
 * Prerequisites on WordPress:
 *   1. Elementor plugin installed and activated
 *   2. Application Password created (WP Admin → Users → Profile → Application Passwords)
 *   3. figma-pipeline-bridge plugin installed (see /wordpress-plugin/ folder)
 */

const axios = require("axios");
const path  = require("path");
const fs    = require("fs");

/**
 * @param {object} config    - Elementor global config from Stage 3
 * @param {object} templates - { [name]: elementorJson } from Stage 5
 * @param {string} outputDir
 * @returns {Array} pages    - [{ id, title, url, slug }]
 */
async function deployToWordPress(config, templates, outputDir) {
  const wpUrl  = process.env.WP_URL.replace(/\/$/, "");
  const auth   = buildAuth();

  // Test connection
  await testWpConnection(wpUrl, auth);

  // Apply global Elementor settings
  await applyElementorGlobalSettings(wpUrl, auth, config);

  // Deploy each page
  const pages = [];
  for (const [name, templateData] of Object.entries(templates)) {
    const page = await deployPage(wpUrl, auth, name, templateData);
    pages.push(page);
    console.log(`      · Published: "${page.title}"  →  ${page.url}`);
  }

  // Save deployment report
  const report = { wpUrl, deployedAt: new Date().toISOString(), pages };
  fs.writeFileSync(path.join(outputDir, "deployment-report.json"), JSON.stringify(report, null, 2));

  return pages;
}

function buildAuth() {
  const user     = process.env.WP_USER;
  const password = (process.env.WP_APP_PASSWORD || "").replace(/\s/g, "");
  return { username: user, password };
}

async function testWpConnection(wpUrl, auth) {
  try {
    const res = await axios.get(`${wpUrl}/wp-json/wp/v2/users/me`, {
      auth, timeout: 15000,
    });
    if (!res.data?.id) throw new Error("Unexpected response from WP REST API");
    console.log(`      · Connected as: ${res.data.name} (${res.data.roles?.join(", ")})`);
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error(
        "WordPress authentication failed (401).\n" +
        "  • Check WP_USER and WP_APP_PASSWORD in your .env\n" +
        "  • Make sure Application Passwords are enabled (WP Admin → Users → Profile)"
      );
    }
    if (err.response?.status === 404) {
      throw new Error(
        "WordPress REST API not found.\n" +
        "  • Verify WP_URL is correct and has no trailing slash\n" +
        "  • Make sure Permalinks are enabled (WP Admin → Settings → Permalinks → save)"
      );
    }
    throw new Error(`Cannot connect to WordPress: ${err.message}`);
  }
}

async function applyElementorGlobalSettings(wpUrl, auth, config) {
  // Use the pipeline bridge plugin endpoint to update Elementor settings
  try {
    await axios.post(
      `${wpUrl}/wp-json/figma-pipeline/v1/elementor-settings`,
      { settings: config },
      { auth, timeout: 15000 }
    );
    console.log("      · Elementor global settings applied ✓");
  } catch (err) {
    if (err.response?.status === 404) {
      console.warn("      ⚠  figma-pipeline-bridge plugin not found — skipping global settings.");
      console.warn("         Install wordpress-plugin/figma-pipeline-bridge.php to enable this.");
    } else {
      throw new Error(`Failed to apply Elementor settings: ${err.message}`);
    }
  }
}

async function deployPage(wpUrl, auth, name, templateData) {
  const slug  = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const title = name
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  // Check if page already exists
  let pageId = null;
  try {
    const existing = await axios.get(
      `${wpUrl}/wp-json/wp/v2/pages?slug=${slug}&status=any`,
      { auth, timeout: 10000 }
    );
    if (existing.data?.length > 0) {
      pageId = existing.data[0].id;
    }
  } catch {
    // ignore — will create new
  }

  const elementorData = JSON.stringify(templateData);
  const pagePayload = {
    title,
    slug,
    status:  "publish",
    content: "<!-- Elementor rendered content -->",
    meta: {
      _elementor_edit_mode:    "builder",
      _elementor_template_type: "wp-page",
      _elementor_version:      "3.0.0",
      _elementor_data:         elementorData,
    },
  };

  let page;
  try {
    if (pageId) {
      // Update existing page
      const res = await axios.put(
        `${wpUrl}/wp-json/wp/v2/pages/${pageId}`,
        pagePayload,
        { auth, timeout: 30000 }
      );
      page = res.data;
    } else {
      // Create new page
      const res = await axios.post(
        `${wpUrl}/wp-json/wp/v2/pages`,
        pagePayload,
        { auth, timeout: 30000 }
      );
      page = res.data;
    }
  } catch (err) {
    // If meta fields are blocked, try the bridge plugin endpoint
    if (err.response?.status === 400 || err.response?.status === 403) {
      page = await deployPageViaBridge(wpUrl, auth, { title, slug, elementorData });
    } else {
      throw new Error(`Failed to create/update page "${title}": ${err.message}`);
    }
  }

  // Flush Elementor CSS cache
  try {
    await axios.post(
      `${wpUrl}/wp-json/figma-pipeline/v1/flush-css`,
      {},
      { auth, timeout: 10000 }
    );
  } catch {
    // Non-fatal — Elementor will regenerate CSS on next page visit
  }

  return {
    id:    page.id,
    title: page.title?.rendered || title,
    url:   page.link || `${wpUrl}/${slug}/`,
    slug,
  };
}

async function deployPageViaBridge(wpUrl, auth, { title, slug, elementorData }) {
  try {
    const res = await axios.post(
      `${wpUrl}/wp-json/figma-pipeline/v1/deploy-page`,
      { title, slug, elementor_data: elementorData },
      { auth, timeout: 30000 }
    );
    return res.data;
  } catch (err) {
    if (err.response?.status === 404) {
      throw new Error(
        'WordPress meta fields are restricted and figma-pipeline-bridge plugin is not installed.\n' +
        '  Install the plugin from the "wordpress-plugin/" folder and activate it, then re-run.'
      );
    }
    throw new Error(`Bridge plugin deployment failed: ${err.message}`);
  }
}

module.exports = deployToWordPress;
