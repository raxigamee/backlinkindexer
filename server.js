const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ===================== CONFIGURATION =====================
const PORT = process.env.PORT || 3000;

// WordPress connection details (set these as environment variables on Render)
// WP_URL: e.g. "https://homecrop.in" (no trailing slash)
// WP_USERNAME: the WordPress username tied to the Application Password
// WP_APP_PASSWORD: the Application Password generated in WP Admin -> Users -> Profile
// WP_PAGE_SLUG: the slug for the page this script maintains (default: "sitemap")
const WP_URL = (process.env.WP_URL || "https://homecrop.in").replace(/\/$/, '');
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
const WP_PAGE_SLUG = process.env.WP_PAGE_SLUG || "sitemap";

if (!WP_USERNAME || !WP_APP_PASSWORD) {
    console.warn("[!] WP_USERNAME or WP_APP_PASSWORD is not set. WordPress publishing will fail until these are configured.");
}

// Basic Auth header for WordPress Application Passwords
const wpAuthHeader = 'Basic ' + Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64');

// Configure Google Auth.
// On Render (or any host), set an env var GOOGLE_SERVICE_ACCOUNT_JSON containing
// the full contents of your service-account.json file.
// Locally, it will fall back to reading service-account.json from disk.
const KEY_FILE = path.join(__dirname, 'service-account.json');

let auth;
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log("[i] Using Google credentials from GOOGLE_SERVICE_ACCOUNT_JSON environment variable.");
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://googleapis.com']
    });
} else {
    console.log("[i] GOOGLE_SERVICE_ACCOUNT_JSON not set — falling back to local service-account.json file.");
    auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://googleapis.com']
    });
}

/**
 * Finds an existing WordPress page by slug. Returns the page object or null.
 * FIXED: Removed the status filter argument to avoid "rest_forbidden_status" errors.
 */
async function findPageBySlug(slug) {
    const url = `${WP_URL}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}`;
    const response = await fetch(url, {
        headers: { 'Authorization': wpAuthHeader }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`WordPress lookup failed (${response.status}): ${text}`);
    }

    const results = await response.json();
    return Array.isArray(results) && results.length > 0 ? results[0] : null;
}

/**
 * Creates a new WordPress page with the given slug and HTML content.
 */
async function createPage(slug, title, contentHtml) {
    const url = `${WP_URL}/wp-json/wp/v2/pages`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': wpAuthHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            slug,
            title,
            content: contentHtml,
            status: 'publish'
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`WordPress page creation failed (${response.status}): ${text}`);
    }

    return response.json();
}

/**
 * Updates an existing WordPress page's content by its ID.
 */
async function updatePage(pageId, contentHtml) {
    const url = `${WP_URL}/wp-json/wp/v2/pages/${pageId}`;
    const response = await fetch(url, {
        method: 'POST', // WordPress REST API uses POST for partial updates too
        headers: {
            'Authorization': wpAuthHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            content: contentHtml,
            status: 'publish'
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`WordPress page update failed (${response.status}): ${text}`);
    }

    return response.json();
}

/**
 * Endpoint to receive backlinks and publish/update a WordPress page referencing them.
 * POST http://localhost:3000/api/index
 * Body: { "targetUrl": "https://medium.com" }
 */
app.post('/api/index', async (req, res) => {
    const { targetUrl } = req.body;

    if (!targetUrl || !targetUrl.startsWith('http')) {
        return res.status(400).json({ error: "A valid absolute targetUrl parameter is required." });
    }

    if (!WP_USERNAME || !WP_APP_PASSWORD) {
        return res.status(500).json({ error: "WordPress credentials are not configured on the server." });
    }

    try {
        const timestamp = new Date().toISOString();
        const absoluteCoverageUrl = `${WP_URL}/${WP_PAGE_SLUG}`;

        // 1. Build the LiveBlogPosting JSON-LD.
        //    Using "liveBlogUpdate" arrays forces Googlebot to read this as breaking information.
        const contentHtml = `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LiveBlogPosting",
  "@id": "${absoluteCoverageUrl}#liveblog",
  "headline": "Real-time Reference Index Coverage",
  "description": "Live streaming updates and index reference signals.",
  "datePublished": "${timestamp}",
  "dateModified": "${timestamp}",
  "coverageStartTime": "${timestamp}",
  "coverageEndTime": "${new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()}",
  "author": {
    "@type": "Organization",
    "name": "Index Manager"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Homecrop",
    "logo": {
      "@type": "ImageObject",
      "url": "${WP_URL}/favicon.ico"
    }
  },
  "liveBlogUpdate": [
    {
      "@type": "BlogPosting",
      "@id": "${absoluteCoverageUrl}#update-${Date.now()}",
      "headline": "New Index Target Discovered",
      "datePublished": "${timestamp}",
      "dateModified": "${timestamp}",
      "articleBody": "New live signal processing deployed for target destination.",
      "mainEntityOfPage": "${absoluteCoverageUrl}",
      "sharedContent": {
        "@type": "WebPage",
        "url": "${targetUrl}"
      }
    }
  ]
}
</script>

<h2>Live Coverage Index</h2>
<p>⚡ <strong>Status:</strong> Live Monitoring Active</p>
<p>Last Sync Engine Iteration: <code>${timestamp}</code></p>

<hr />

<div class="live-update-entry">
  <h3>Update Broadcast [${new Date().toLocaleTimeString()}]</h3>
  <p>Target reference point successfully updated to index configuration cluster:</p>
  <p>➡️ <a href="${targetUrl}" rel="noopener" target="_blank"><strong>${targetUrl}</strong></a></p>
</div>
`;

        // 2. Find or create the WordPress page
        const existingPage = await findPageBySlug(WP_PAGE_SLUG);
        let wpPage;
        if (existingPage) {
            wpPage = await updatePage(existingPage.id, contentHtml);
            console.log(`[+] Updated existing LiveBlog page (id ${existingPage.id}) with target: ${targetUrl}`);
        } else {
            wpPage = await createPage(WP_PAGE_SLUG, "Live Coverage Index", contentHtml);
            console.log(`[+] Created new LiveBlog page (id ${wpPage.id}) with target: ${targetUrl}`);
        }

        const liveUrl = wpPage.link; // The actual public URL WordPress assigned

        // 3. Authorize with Google APIs
        const authClient = await auth.getClient();

        // 4. Notify the Google Indexing API about the live WordPress page
        const indexing = google.indexing({ version: 'v3', auth: authClient });

        const response = await indexing.urlNotifications.publish({
            requestBody: {
                url: liveUrl,
                type: 'URL_UPDATED' // Triggers immediate crawling prioritized over standard schedules
            }
        });

        // 5. Return success to caller
        return res.status(200).json({
            success: true,
            message: "LiveBlog schema page published. Google Index API forced successfully.",
            wordpressUrl: liveUrl,
            injectedTarget: targetUrl,
            googleApiResponse: response.data
        });

    } catch (error) {
        console.error("[-] Engine Failure during indexing operation:", error);
        return res.status(500).json({
            error: "Internal indexing engine error.",
            details: error.message
        });
    }
});

// Start the Application Server
app.listen(PORT, () => {
    console.log(`🚀 Indexer core online and listening on port ${PORT}`);
});
