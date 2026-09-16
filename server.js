const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// =====================================================
// CONFIGURATION
// =====================================================

const PORT = process.env.PORT || 3000;

const WP_URL = (process.env.WP_URL || 'https://homecrop.in').replace(/\/$/, '');
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

const WP_PAGE_SLUG = process.env.WP_PAGE_SLUG || 'sitemap';

const KEY_FILE = path.join(__dirname, 'service-account.json');


// =====================================================
// WORDPRESS AUTHENTICATION
// =====================================================

if (!WP_USERNAME || !WP_APP_PASSWORD) {
    console.warn(
        '[!] WP_USERNAME or WP_APP_PASSWORD is not configured.'
    );
}

const wpAuthHeader =
    'Basic ' +
    Buffer.from(
        `${WP_USERNAME || ''}:${WP_APP_PASSWORD || ''}`
    ).toString('base64');


// =====================================================
// GOOGLE AUTHENTICATION
// =====================================================

let auth;

try {

    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {

        console.log(
            '[i] Using Google credentials from GOOGLE_SERVICE_ACCOUNT_JSON.'
        );

        let credentials;

        try {
            credentials = JSON.parse(
                process.env.GOOGLE_SERVICE_ACCOUNT_JSON
            );
        } catch (error) {
            throw new Error(
                'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.'
            );
        }

        auth = new google.auth.GoogleAuth({
            credentials: credentials,

            // Correct Google Indexing API scope
            scopes: [
                'https://www.googleapis.com/auth/indexing'
            ]
        });

    } else {

        console.log(
            '[i] GOOGLE_SERVICE_ACCOUNT_JSON not found.'
        );

        console.log(
            '[i] Using local service-account.json file.'
        );

        if (!fs.existsSync(KEY_FILE)) {
            throw new Error(
                `service-account.json not found at: ${KEY_FILE}`
            );
        }

        auth = new google.auth.GoogleAuth({
            keyFile: KEY_FILE,

            // Correct Google Indexing API scope
            scopes: [
                'https://www.googleapis.com/auth/indexing'
            ]
        });
    }

} catch (error) {

    console.error(
        '[!] Google authentication configuration error:',
        error.message
    );

    process.exit(1);
}


// =====================================================
// FIND WORDPRESS PAGE BY SLUG
// =====================================================

async function findPageBySlug(slug) {

    const url =
        `${WP_URL}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&context=edit`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': wpAuthHeader,
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {

        const text = await response.text();

        throw new Error(
            `WordPress lookup failed (${response.status}): ${text}`
        );
    }

    const results = await response.json();

    if (Array.isArray(results) && results.length > 0) {

        const page = results[0];

        console.log(
            `[+] Found WordPress page ID: ${page.id}`
        );

        console.log(
            `[+] Found WordPress page URL: ${page.link}`
        );

        console.log(
            `[+] Existing content length: ${
                page.content?.raw?.length || 0
            }`
        );

        return page;
    }

    return null;
}


// =====================================================
// CREATE WORDPRESS PAGE
// =====================================================

async function createPage(slug, title, contentHtml) {

    const url =
        `${WP_URL}/wp-json/wp/v2/pages`;

    const response = await fetch(url, {

        method: 'POST',

        headers: {
            'Authorization': wpAuthHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },

        body: JSON.stringify({
            slug: slug,
            title: title,
            content: contentHtml,
            status: 'publish',
            template: ''
        })
    });

    if (!response.ok) {

        const text = await response.text();

        throw new Error(
            `WordPress page creation failed (${response.status}): ${text}`
        );
    }

    return await response.json();
}


// =====================================================
// UPDATE WORDPRESS PAGE
// =====================================================

async function updatePage(pageId, contentHtml) {

    const url =
        `${WP_URL}/wp-json/wp/v2/pages/${pageId}`;

    const response = await fetch(url, {

        method: 'POST',

        headers: {
            'Authorization': wpAuthHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },

        body: JSON.stringify({
            content: contentHtml,
            status: 'publish',

            // Use normal WordPress page template
            template: ''
        })
    });

    const text = await response.text();

    if (!response.ok) {

        throw new Error(
            `WordPress page update failed (${response.status}): ${text}`
        );
    }

    const data = JSON.parse(text);

    console.log(
        '[+] WordPress page updated successfully.'
    );

    console.log(
        `[+] Page ID: ${data.id}`
    );

    console.log(
        `[+] Page URL: ${data.link}`
    );

    console.log(
        `[+] Saved content length: ${
            data.content?.raw?.length || 0
        }`
    );

    if (!data.content || !data.content.raw) {

        console.warn(
            '[!] WordPress did not return content.raw.'
        );
    }


    // =================================================
    // VERIFY SAVED CONTENT
    // =================================================

    const verifyResponse = await fetch(
        `${WP_URL}/wp-json/wp/v2/pages/${pageId}?context=edit`,
        {
            method: 'GET',
            headers: {
                'Authorization': wpAuthHeader,
                'Accept': 'application/json'
            }
        }
    );

    const verifyText =
        await verifyResponse.text();

    if (!verifyResponse.ok) {

        throw new Error(
            `WordPress content verification failed (${verifyResponse.status}): ${verifyText}`
        );
    }

    const verifiedPage =
        JSON.parse(verifyText);

    const savedContent =
        verifiedPage.content?.raw || '';

    console.log(
        `[+] Verified saved content length: ${savedContent.length}`
    );


    if (!savedContent.includes('Live Coverage Index')) {

        throw new Error(
            'WordPress accepted the update but the expected page content was not found during verification.'
        );
    }

    console.log(
        '[+] WordPress content verification successful.'
    );

    return verifiedPage;
}


// =====================================================
// DEBUG WORDPRESS
// =====================================================

app.get('/api/debug-wp', async (req, res) => {

    return res.json({

        WP_URL: WP_URL,

        usernameSet: !!WP_USERNAME,

        username: WP_USERNAME || null,

        passwordSet: !!WP_APP_PASSWORD,

        passwordLength:
            WP_APP_PASSWORD
                ? WP_APP_PASSWORD.length
                : 0,

        authHeaderCreated:
            !!wpAuthHeader
    });
});


// =====================================================
// TEST WORDPRESS AUTHENTICATION
// =====================================================

app.get('/api/wp-test', async (req, res) => {

    try {

        if (!WP_USERNAME || !WP_APP_PASSWORD) {

            return res.status(500).json({

                error:
                    'WordPress credentials are not configured.'
            });
        }

        const credentials =
            `${WP_USERNAME}:${WP_APP_PASSWORD}`;

        const encoded =
            Buffer.from(credentials).toString('base64');

        console.log(
            '[i] WordPress username:',
            WP_USERNAME
        );

        console.log(
            '[i] WordPress password length:',
            WP_APP_PASSWORD.length
        );

        const response =
            await fetch(
                `${WP_URL}/wp-json/wp/v2/users/me?context=edit`,
                {
                    method: 'GET',

                    headers: {
                        'Authorization':
                            `Basic ${encoded}`,

                        'Accept':
                            'application/json'
                    }
                }
            );

        const text =
            await response.text();

        console.log(
            '[i] WordPress status:',
            response.status
        );

        console.log(
            '[i] WordPress response:',
            text
        );

        return res
            .status(response.status)
            .send(text);

    } catch (error) {

        console.error(
            '[!] WordPress test error:',
            error
        );

        return res.status(500).json({

            error:
                error.message
        });
    }
});


// =====================================================
// TEST GOOGLE AUTHENTICATION
// =====================================================

app.get('/api/google-test', async (req, res) => {

    try {

        console.log(
            '[i] Testing Google authentication...'
        );

        const authClient =
            await auth.getClient();

        const tokenResponse =
            await authClient.getAccessToken();

        if (
            !tokenResponse ||
            !tokenResponse.token
        ) {

            throw new Error(
                'Google authentication did not return an access token.'
            );
        }

        console.log(
            '[+] Google authentication successful.'
        );

        return res.json({

            success: true,

            message:
                'Google service-account authentication is working.',

            accessTokenReceived:
                true
        });

    } catch (error) {

        console.error(
            '[!] Google authentication failed:',
            error
        );

        return res.status(500).json({

            success: false,

            error:
                'Google authentication failed.',

            details:
                error.message
        });
    }
});


// =====================================================
// INDEX URL
// =====================================================

app.post('/api/index', async (req, res) => {

    const { targetUrl } =
        req.body;


    // =================================================
    // VALIDATE TARGET URL
    // =================================================

    if (
        !targetUrl ||
        (
            !targetUrl.startsWith('http://') &&
            !targetUrl.startsWith('https://')
        )
    ) {

        return res.status(400).json({

            error:
                'A valid absolute targetUrl parameter is required.'
        });
    }


    // =================================================
    // CHECK WORDPRESS CREDENTIALS
    // =================================================

    if (
        !WP_USERNAME ||
        !WP_APP_PASSWORD
    ) {

        return res.status(500).json({

            error:
                'WordPress credentials are not configured on the server.'
        });
    }


    try {

        // =================================================
        // 1. CREATE PAGE CONTENT
        // =================================================

        const timestamp =
            new Date().toISOString();

        const updateId =
            Date.now();

        const absoluteCoverageUrl =
            `${WP_URL}/${WP_PAGE_SLUG}/`;


        const contentHtml = `
<div class="live-coverage-index">

    <h1>Live Coverage Index</h1>

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

        <h2>New Index Target Discovered</h2>

        <p>
            Target reference point successfully updated:
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

        <p>
            Update Broadcast:
            ${new Date().toLocaleTimeString()}
        </p>

    </div>

</div>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": "${absoluteCoverageUrl}#webpage",
  "url": "${absoluteCoverageUrl}",
  "name": "Live Coverage Index",
  "description": "Live reference coverage page.",
  "dateModified": "${timestamp}"
}
</script>
`;


        // =================================================
        // 2. FIND OR CREATE WORDPRESS PAGE
        // =================================================

        console.log(
            '[i] Checking WordPress page:',
            WP_PAGE_SLUG
        );

        const existingPage =
            await findPageBySlug(
                WP_PAGE_SLUG
            );

        let wpPage;


        if (existingPage) {

            console.log(
                `[i] Existing WordPress page found. ID: ${existingPage.id}`
            );

            wpPage =
                await updatePage(
                    existingPage.id,
                    contentHtml
                );

            console.log(
                `[+] WordPress page updated: ${wpPage.link}`
            );

        } else {

            console.log(
                '[i] WordPress page does not exist. Creating...'
            );

            wpPage =
                await createPage(
                    WP_PAGE_SLUG,
                    'Live Coverage Index',
                    contentHtml
                );

            console.log(
                `[+] WordPress page created: ${wpPage.link}`
            );
        }


        const liveUrl =
            wpPage.link;


        // =================================================
        // 3. GOOGLE AUTHENTICATION
        // =================================================

        console.log(
            '[i] Authenticating with Google...'
        );

        const authClient =
            await auth.getClient();


        const tokenResponse =
            await authClient.getAccessToken();


        if (
            !tokenResponse ||
            !tokenResponse.token
        ) {

            throw new Error(
                'Google authentication failed: no access token received.'
            );
        }


        console.log(
            '[+] Google authentication successful.'
        );


        // =================================================
        // 4. GOOGLE INDEXING API
        // =================================================

        console.log(
            '[i] Sending WordPress page URL to Google Indexing API:',
            liveUrl
        );

        console.log(
            '[i] Target URL included in page content:',
            targetUrl
        );


        const indexing =
            google.indexing({

                version: 'v3',

                auth: authClient
            });


        const response =
            await indexing
                .urlNotifications
                .publish({

                    requestBody: {

                        url:
                            liveUrl,

                        type:
                            'URL_UPDATED'
                    }
                });


        console.log(
            '[+] Google Indexing API response:',
            response.data
        );


        // =================================================
        // 5. SUCCESS RESPONSE
        // =================================================

        return res.status(200).json({

            success:
                true,

            message:
                'WordPress page published and Google Indexing API request completed.',

            wordpressUrl:
                liveUrl,

            injectedTarget:
                targetUrl,

            googleApiResponse:
                response.data,

            savedContentLength:
                wpPage.content?.raw?.length || 0,

            contentVerified:
                true,

            submittedToGoogle:
                liveUrl
        });


    } catch (error) {

        console.error(
            '[-] Indexing engine failure:',
            error
        );


        return res.status(500).json({

            error:
                'Internal indexing engine error.',

            details:
                error.message,

            wordpressUrl:
                null,

            googleAuthentication:
                error.message &&
                error.message
                    .toLowerCase()
                    .includes('authentication')
                    ? 'FAILED'
                    : 'UNKNOWN'
        });
    }
});


// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {

    console.log(
        `🚀 Indexer core online on port ${PORT}`
    );

    console.log(
        `🌐 WordPress: ${WP_URL}`
    );

    console.log(
        `📄 Page slug: ${WP_PAGE_SLUG}`
    );

    console.log(
        '🔐 Google scope: https://www.googleapis.com/auth/indexing'
    );
});
