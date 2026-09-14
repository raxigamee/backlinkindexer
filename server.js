const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

// CONFIGURATION PARAMETERS
const PORT = process.env.PORT || 3000;
const HUB_SITE_URL = "https://homecrop.in/"; // Replace with your verified GSC domain
const SITEMAP_DIR = path.join(__dirname, 'public');
const SITEMAP_PATH = path.join(SITEMAP_DIR, 'sitemap.html');
const KEY_FILE = path.join(__dirname, 'service-account.json');

// Ensure public directory exists
if (!fs.existsSync(SITEMAP_DIR)) {
    fs.mkdirSync(SITEMAP_DIR, { recursive: true });
}

// Serve the public folder so Googlebot can download sitemap.html
app.use(express.static('public'));

// Configure Google Auth using the service account key file
const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/indexing']
});

/**
 * Endpoint to receive unowned backlinks
 * POST http://localhost:3000/api/index
 * Body: { "targetUrl": "https://medium.com" }
 */
app.post('/api/index', async (req, res) => {
    const { targetUrl } = req.body;

    if (!targetUrl || !targetUrl.startsWith('http')) {
        return res.status(400).json({ error: "A valid absolute targetUrl parameter is required." });
    }

    try {
        const timestamp = new Date().toISOString();

        // 1. Generate HTML featuring the prioritized LiveBlogPosting Schema
        const dynamicHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Live Breaking Index Feed</title>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "LiveBlogPosting",
      "headline": "Real-Time Infrastructure Routing Sync",
      "datePublished": "${timestamp}",
      "dateModified": "${timestamp}",
      "coverageStartTime": "${timestamp}",
      "description": "Urgent crawling pipeline active.",
      "liveBlogUpdate": [
        {
          "@type": "BlogPosting",
          "headline": "Network Update Nodes",
          "datePublished": "${timestamp}",
          "articleBody": "System routing path verified.",
          "sharedContent": {
            "@type": "WebPage",
            "url": "${targetUrl}"
          }
        }
      ]
    }
    </script>
</head>
<body>
    <h1>🔴 Priority Event Stream Node</h1>
    <p>Data payload distribution active.</p>
    <ul>
        <li><a href="${targetUrl}" rel="dofollow">Target Index Route</a></li>
    </ul>
</body>
</html>`;

        // Write the code instantly to the public file directory
        fs.writeFileSync(SITEMAP_PATH, dynamicHtml, 'utf8');
        console.log(`[+] HTML updated with target: ${targetUrl}`);

        // 2. Authorize with Google APIs
        const authClient = await auth.getClient();

        // 3. Fire the Indexing API Emergency Ping targeting your Hub file
        const indexing = google.indexing({ version: 'v3', auth: authClient });
        const targetHubUrl = `${HUB_SITE_URL}/sitemap.html`;

        const response = await indexing.urlNotifications.publish({
            requestBody: {
                url: targetHubUrl,
                type: 'URL_UPDATED' // Forces Googlebot to prioritize your domain immediately
            }
        });

        // 4. Return success to user/client application
        return res.status(200).json({
            success: true,
            message: "Googlebot priority crawl triggered successfully.",
            hubUrlChecked: targetHubUrl,
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