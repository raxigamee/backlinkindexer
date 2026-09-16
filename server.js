const express = require('express');
const { google } = require('googleapis');
const path = require('path');

const app = express();
app.use(express.json());

// =====================================================
// CONFIGURATION
// =====================================================

const PORT = process.env.PORT || 3000;

const WP_URL = (process.env.WP_URL || 'https://homecrop.in').replace(/\/$/, '');
const WP_USERNAME = (process.env.WP_USERNAME || '').trim();
const WP_APP_PASSWORD = (process.env.WP_APP_PASSWORD || '').trim();
const WP_PAGE_SLUG = (process.env.WP_PAGE_SLUG || 'sitemap').trim();

const KEY_FILE = path.join(__dirname, 'service-account.json');

// =====================================================
// CONFIG CHECK
// =====================================================

console.log('================ CONFIG ================');
console.log('WP_URL:', WP_URL);
console.log('WP_USERNAME:', WP_USERNAME || '[NOT SET]');
console.log('WP_APP_PASSWORD SET:', !!WP_APP_PASSWORD);
console.log(
    'WP_APP_PASSWORD LENGTH:',
    WP_APP_PASSWORD ? WP_APP_PASSWORD.length : 0
);
console.log('WP_PAGE_SLUG:', WP_PAGE_SLUG);
console.log('========================================');

if (!WP_USERNAME || !WP_APP_PASSWORD) {
    console.warn(
        '[!] WP_USERNAME or WP_APP_PASSWORD is missing.'
    );
}

// =====================================================
// WORDPRESS AUTH
// =====================================================

function getWpAuthHeader() {
    if (!WP_USERNAME || !WP_APP_PASSWORD) {
        throw new Error(
            'WordPress username or Application Password is missing.'
        );
    }

    const credentials = `${WP_USERNAME}:${WP_APP_PASSWORD}`;

    return 'Basic ' + Buffer
        .from(credentials, 'utf8')
        .toString('base64');
}

// =====================================================
// WORDPRESS REQUEST HELPER
// =====================================================

async function wpRequest(url, options = {}) {

    const headers = {
        'Authorization': getWpAuthHeader(),
        'Accept': 'application/json',
        ...(options.headers || {})
    };

    const response = await fetch(url, {
        ...options,
        headers
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    if (!response.ok) {
        const error = new Error(
            `WordPress request failed (${response.status})`
        );

        error.status = response.status;
        error.data = data;

        throw error;
    }

    return data;
}

// =====================================================
// TEST WORDPRESS AUTHENTICATION
// =====================================================

app.get('/api/wp-test', async (req, res) => {

    try {

        console.log('========================================');
        console.log('WORDPRESS AUTH TEST');
        console.log('========================================');

        console.log('WordPress URL:', WP_URL);
        console.log('Username:', WP_USERNAME);
        console.log(
            'Application Password length:',
            WP_APP_PASSWORD.length
        );

        const authHeader = getWpAuthHeader();

        console.log(
            'Authorization header created:',
            !!authHeader
        );

        console.log(
            'Authorization prefix:',
            authHeader.substring(0, 10) + '...'
        );

        const url =
            `${WP_URL}/wp-json/wp/v2/users/me?context=edit`;

        console.log('Testing:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        });

        const text = await response.text();

        console.log('WordPress HTTP status:', response.status);
        console.log('WordPress response:', text);

        return res.status(response.status).send(text);

    } catch (error) {

        console.error('WORDPRESS AUTH TEST ERROR:', error);

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =====================================================
// DEBUG CONFIGURATION
// =====================================================

app.get('/api/debug-wp', (req, res) => {

    return res.json({
        wpUrl: WP_URL,

        usernameSet: !!WP_USERNAME,

        // Showing username is okay for debugging,
        // but remove this endpoint in production.
        username: WP_USERNAME || null,

        passwordSet: !!WP_APP_PASSWORD,

        passwordLength:
            WP_APP_PASSWORD
                ? WP_APP_PASSWORD.length
                : 0,

        authHeaderCreated:
            !!(
                WP_USERNAME &&
                WP_APP_PASSWORD
            )
    });
});

// =====================================================
// FIND WORDPRESS PAGE BY SLUG
// =====================================================

async function findPageBySlug(slug) {

    const url =
        `${WP_URL}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}`;

    console.log('[WP] Looking for page:', slug);

    try {

        const results = await wpRequest(url);

        if (
            Array.isArray(results) &&
            results.length > 0
        ) {
            console.log(
                `[WP] Found page ID: ${results[0].id}`
            );

            return results[0];
        }

        console.log('[WP] Page not found.');

        return null;

    } catch (error) {

        throw new Error(
            `WordPress page lookup failed: ${JSON.stringify(error.data || error.message)}`
        );
    }
}

// =====================================================
// CREATE WORDPRESS PAGE
// =====================================================

async function createPage(
    slug,
    title,
    contentHtml
) {

    const url =
        `${WP_URL}/wp-json/wp/v2/pages`;

    console.log('[WP] Creating page:', slug);

    try {

        const data = await wpRequest(url, {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json'
            },

            body: JSON.stringify({
                slug: slug,
                title: title,
                content: contentHtml,
                status: 'publish'
            })
        });

        console.log(
            `[WP] Page created. ID: ${data.id}`
        );

        return data;

    } catch (error) {

        throw new Error(
            `WordPress page creation failed: ${JSON.stringify(error.data || error.message)}`
        );
    }
}

// =====================================================
// UPDATE WORDPRESS PAGE
// =====================================================

async function updatePage(
    pageId,
    contentHtml
) {

    const url =
        `${WP_URL}/wp-json/wp/v2/pages/${pageId}`;

    console.log(
        `[WP] Updating page ID: ${pageId}`
    );

    try {

        const data = await wpRequest(url, {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json'
            },

            body: JSON.stringify({
                content: contentHtml
            })
        });

        console.log(
            `[WP] Page updated. ID: ${data.id}`
        );

        return data;

    } catch (error) {

        throw new Error(
            `WordPress page update failed: ${JSON.stringify(error.data || error.message)}`
        );
    }
}

// =====================================================
// GOOGLE AUTHENTICATION
// =====================================================

let auth;

if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {

    console.log(
        '[Google] Using credentials from environment variable.'
    );

    const credentials =
        JSON.parse(
            process.env.GOOGLE_SERVICE_ACCOUNT_JSON
        );

    auth = new google.auth.GoogleAuth({

        credentials,

        scopes: [
            'https://www.googleapis.com/auth/indexing'
        ]
    });

} else {

    console.log(
        '[Google] Using local service-account.json'
    );

    auth = new google.auth.GoogleAuth({

        keyFile: KEY_FILE,

        scopes: [
            'https://www.googleapis.com/auth/indexing'
        ]
    });
}

// =====================================================
// MAIN INDEX ENDPOINT
// =====================================================

app.post('/api/index', async (req, res) => {

    const { targetUrl } = req.body;

    // -------------------------------------------------
    // Validate target URL
    // -------------------------------------------------

    if (
        !targetUrl ||
        !/^https?:\/\//i.test(targetUrl)
    ) {

        return res.status(400).json({
            success: false,
            error:
                'A valid absolute targetUrl parameter is required.'
        });
    }

    // -------------------------------------------------
    // Validate WP credentials
    // -------------------------------------------------

    if (
        !WP_USERNAME ||
        !WP_APP_PASSWORD
    ) {

        return res.status(500).json({
            success: false,
            error:
                'WordPress credentials are not configured.'
        });
    }

    try {

        const timestamp =
            new Date().toISOString();

        const absoluteCoverageUrl =
            `${WP_URL}/${WP_PAGE_SLUG}`;

        // -------------------------------------------------
        // WordPress content
        // -------------------------------------------------

        const contentHtml = `
<h2>Live Coverage Index</h2>

<p>
<strong>Status:</strong>
Live Monitoring Active
</p>

<p>
Last Sync Engine Iteration:
<code>${timestamp}</code>
</p>

<hr>

<div class="live-update-entry">

<h3>
Update Broadcast
</h3>

<p>
Target reference point:
</p>

<p>
<a
    href="${targetUrl}"
    rel="noopener noreferrer"
    target="_blank"
>
<strong>${targetUrl}</strong>
</a>
</p>

</div>
`;

        // -------------------------------------------------
        // Find existing page
        // -------------------------------------------------

        const existingPage =
            await findPageBySlug(WP_PAGE_SLUG);

        let wpPage;

        // -------------------------------------------------
        // Update existing page
        // -------------------------------------------------

        if (existingPage) {

            wpPage =
                await updatePage(
                    existingPage.id,
                    contentHtml
                );

            console.log(
                `[+] Updated WordPress page ${existingPage.id}`
            );

        }

        // -------------------------------------------------
        // Create new page
        // -------------------------------------------------

        else {

            wpPage =
                await createPage(
                    WP_PAGE_SLUG,
                    'Live Coverage Index',
                    contentHtml
                );

            console.log(
                `[+] Created WordPress page ${wpPage.id}`
            );
        }

        const liveUrl =
            wpPage.link;

        // -------------------------------------------------
        // Google authentication
        // -------------------------------------------------

        const authClient =
            await auth.getClient();

        const indexing =
            google.indexing({
                version: 'v3',
                auth: authClient
            });

        // -------------------------------------------------
        // Google Indexing API
        // -------------------------------------------------

        const googleResponse =
            await indexing.urlNotifications.publish({

                requestBody: {

                    url: liveUrl,

                    type: 'URL_UPDATED'
                }
            });

        // -------------------------------------------------
        // Success
        // -------------------------------------------------

        return res.status(200).json({

            success: true,

            message:
                'WordPress page created/updated successfully.',

            wordpressUrl:
                liveUrl,

            injectedTarget:
                targetUrl,

            googleApiResponse:
                googleResponse.data
        });

    } catch (error) {

        console.error(
            '========================================'
        );

        console.error(
            'INDEXING ENGINE ERROR'
        );

        console.error(error);

        console.error(
            '========================================'
        );

        return res.status(
            error.status || 500
        ).json({

            success: false,

            error:
                'Indexing engine error.',

            details:
                error.data ||
                error.message
        });
    }
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get('/', (req, res) => {

    res.json({
        status: 'online',
        service: 'WordPress Indexing Tool'
    });
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {

    console.log(
        `🚀 Indexer running on port ${PORT}`
    );

    console.log(
        `🌐 WordPress: ${WP_URL}`
    );
});
