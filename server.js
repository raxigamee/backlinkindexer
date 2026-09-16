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

const WP_URL = (
    process.env.WP_URL || 'https://homecrop.in'
).replace(/\/$/, '');

const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

const WP_PAGE_SLUG =
    process.env.WP_PAGE_SLUG || 'sitemap';

const KEY_FILE =
    path.join(__dirname, 'service-account.json');


// =====================================================
// WORDPRESS AUTH
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
// GOOGLE AUTH
// =====================================================

let auth;

try {

    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {

        console.log(
            '[i] Using GOOGLE_SERVICE_ACCOUNT_JSON.'
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

            credentials,

            scopes: [
                'https://www.googleapis.com/auth/indexing'
            ]
        });

    } else {

        console.log(
            '[i] Using local service-account.json.'
        );

        if (!fs.existsSync(KEY_FILE)) {

            throw new Error(
                `service-account.json not found: ${KEY_FILE}`
            );
        }

        auth = new google.auth.GoogleAuth({

            keyFile: KEY_FILE,

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
// FIND WORDPRESS PAGE
// =====================================================

async function findPageBySlug(slug) {

    const url =
        `${WP_URL}/wp-json/wp/v2/pages` +
        `?slug=${encodeURIComponent(slug)}` +
        `&context=edit`;

    const response = await fetch(url, {

        method: 'GET',

        headers: {
            'Authorization': wpAuthHeader,
            'Accept': 'application/json'
        }
    });

    const text =
        await response.text();

    if (!response.ok) {

        throw new Error(
            `WordPress lookup failed (${response.status}): ${text}`
        );
    }

    const pages =
        JSON.parse(text);

    if (
        Array.isArray(pages) &&
        pages.length > 0
    ) {

        const page = pages[0];

        console.log(
            `[+] Existing page found`
        );

        console.log(
            `[+] Page ID: ${page.id}`
        );

        console.log(
            `[+] Page URL: ${page.link}`
        );

        console.log(
            `[+] Page slug: ${page.slug}`
        );

        console.log(
            `[+] Current content length: ${
                page.content?.raw?.length || 0
            }`
        );

        return page;
    }

    console.log(
        '[i] No existing page found.'
    );

    return null;
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

    const response = await fetch(url, {

        method: 'POST',

        headers: {

            'Authorization':
                wpAuthHeader,

            'Content-Type':
                'application/json',

            'Accept':
                'application/json'
        },

        body: JSON.stringify({

            slug: slug,

            title: title,

            content: contentHtml,

            status: 'publish',

            // Force normal WordPress template
            template: ''
        })
    });

    const text =
        await response.text();

    if (!response.ok) {

        throw new Error(
            `WordPress page creation failed (${response.status}): ${text}`
        );
    }

    const page =
        JSON.parse(text);

    console.log(
        `[+] WordPress page created: ${page.id}`
    );

    console.log(
        `[+] Created URL: ${page.link}`
    );

    console.log(
        `[+] Saved content length: ${
            page.content?.raw?.length || 0
        }`
    );

    return page;
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
        `[i] Updating WordPress page ID: ${pageId}`
    );

    const response = await fetch(url, {

        method: 'POST',

        headers: {

            'Authorization':
                wpAuthHeader,

            'Content-Type':
                'application/json',

            'Accept':
                'application/json'
        },

        body: JSON.stringify({

            content:
                contentHtml,

            status:
                'publish',

            // IMPORTANT:
            // Empty template = use normal/default page template
            template:
                ''
        })
    });

    const text =
        await response.text();

    if (!response.ok) {

        throw new Error(
            `WordPress page update failed (${response.status}): ${text}`
        );
    }

    const page =
        JSON.parse(text);

    console.log(
        '[+] WordPress update successful.'
    );

    console.log(
        `[+] Page ID: ${page.id}`
    );

    console.log(
        `[+] Page URL: ${page.link}`
    );

    console.log(
        `[+] Content length returned: ${
            page.content?.raw?.length || 0
        }`
    );

    return page;
}


// =====================================================
// VERIFY WORDPRESS PAGE
// =====================================================

async function verifyPage(pageId) {

    const url =
        `${WP_URL}/wp-json/wp/v2/pages/${pageId}?context=edit`;

    console.log(
        `[i] Verifying page ID: ${pageId}`
    );

    const response = await fetch(url, {

        method: 'GET',

        headers: {

            'Authorization':
                wpAuthHeader,

            'Accept':
                'application/json'
        }
    });

    const text =
        await response.text();

    if (!response.ok) {

        throw new Error(
            `WordPress verification failed (${response.status}): ${text}`
        );
    }

    const page =
        JSON.parse(text);

    const content =
        page.content?.raw || '';

    console.log(
        `[+] Verified content length: ${content.length}`
    );

    return page;
}


// =====================================================
// DEBUG WORDPRESS
// =====================================================

app.get(
    '/api/debug-wp',
    async (req, res) => {

        return res.json({

            WP_URL,

            WP_PAGE_SLUG,

            usernameSet:
                !!WP_USERNAME,

            username:
                WP_USERNAME || null,

            passwordSet:
                !!WP_APP_PASSWORD,

            passwordLength:
                WP_APP_PASSWORD
                    ? WP_APP_PASSWORD.length
                    : 0,

            authHeaderCreated:
                !!wpAuthHeader
        });
    }
);


// =====================================================
// TEST WORDPRESS
// =====================================================

app.get(
    '/api/wp-test',
    async (req, res) => {

        try {

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

            const response =
                await fetch(
                    `${WP_URL}/wp-json/wp/v2/users/me?context=edit`,
                    {

                        method: 'GET',

                        headers: {

                            'Authorization':
                                wpAuthHeader,

                            'Accept':
                                'application/json'
                        }
                    }
                );

            const text =
                await response.text();

            return res
                .status(response.status)
                .send(text);

        } catch (error) {

            return res.status(500).json({

                success: false,

                error:
                    error.message
            });
        }
    }
);


// =====================================================
// TEST GOOGLE
// =====================================================

app.get(
    '/api/google-test',
    async (req, res) => {

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
                    'No Google access token received.'
                );
            }

            console.log(
                '[+] Google authentication successful.'
            );

            return res.json({

                success:
                    true,

                message:
                    'Google service account authentication is working.',

                accessTokenReceived:
                    true
            });

        } catch (error) {

            console.error(
                '[!] Google authentication failed:',
                error
            );

            return res.status(500).json({

                success:
                    false,

                error:
                    'Google authentication failed.',

                details:
                    error.message
            });
        }
    }
);


// =====================================================
// INDEX ENDPOINT
// =====================================================

app.post(
    '/api/index',
    async (req, res) => {

        const {
            targetUrl
        } = req.body;


        // =================================================
        // VALIDATE URL
        // =================================================

        if (
            !targetUrl ||
            (
                !targetUrl.startsWith('http://') &&
                !targetUrl.startsWith('https://')
            )
        ) {

            return res.status(400).json({

                success:
                    false,

                error:
                    'A valid absolute targetUrl is required.'
            });
        }


        // =================================================
        // WORDPRESS CREDENTIAL CHECK
        // =================================================

        if (
            !WP_USERNAME ||
            !WP_APP_PASSWORD
        ) {

            return res.status(500).json({

                success:
                    false,

                error:
                    'WordPress credentials are not configured.'
            });
        }


        try {

            // =================================================
            // 1. TIMESTAMP
            // =================================================

            const timestamp =
                new Date().toISOString();

            const updateId =
                Date.now();

            const absoluteCoverageUrl =
                `${WP_URL}/${WP_PAGE_SLUG}/`;


            // =================================================
            // 2. PAGE CONTENT
            // =================================================

            const contentHtml = `

<style>

.live-coverage-index {
    max-width: 1100px;
    margin: 50px auto;
    padding: 40px;
    background: #ffffff;
    box-sizing: border-box;
}

.live-coverage-index h1 {
    font-size: 36px;
    margin-bottom: 20px;
}

.live-coverage-index h2 {
    font-size: 26px;
    margin-top: 30px;
}

.live-coverage-index p {
    font-size: 18px;
    line-height: 1.7;
}

.live-update-entry {
    margin-top: 30px;
    padding: 25px;
    border: 1px solid #ddd;
    background: #f8f8f8;
}

.live-update-entry a {
    word-break: break-all;
}

.live-status {
    font-weight: bold;
}

</style>


<div class="live-coverage-index">

    <h1>
        Live Coverage Index
    </h1>

    <p>
        <strong>Status:</strong>
        <span class="live-status">
            Live Monitoring Active
        </span>
    </p>

    <p>
        Last Sync Engine Iteration:
        <code>${timestamp}</code>
    </p>

    <hr>

    <div class="live-update-entry">

        <h2>
            New Index Target Discovered
        </h2>

        <p>
            Target reference point successfully updated:
        </p>

        <p>
            <strong>
                Target URL:
            </strong>
        </p>

        <p>
            <a
                href="${targetUrl}"
                target="_blank"
                rel="noopener noreferrer"
            >
                ${targetUrl}
            </a>
        </p>

        <p>
            <strong>
                Update Time:
            </strong>

            ${new Date().toLocaleString()}
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


            console.log(
                `[i] Content generated. Length: ${contentHtml.length}`
            );


            // =================================================
            // 3. FIND EXISTING PAGE
            // =================================================

            console.log(
                `[i] Looking for /${WP_PAGE_SLUG}/`
            );

            const existingPage =
                await findPageBySlug(
                    WP_PAGE_SLUG
                );


            let wpPage;


            // =================================================
            // 4. UPDATE OR CREATE
            // =================================================

            if (existingPage) {

                // IMPORTANT:
                // Update the EXISTING page.
                // This prevents sitemap-2, sitemap-3, etc.

                wpPage =
                    await updatePage(
                        existingPage.id,
                        contentHtml
                    );

            } else {

                wpPage =
                    await createPage(
                        WP_PAGE_SLUG,
                        'Live Coverage Index',
                        contentHtml
                    );
            }


            // =================================================
            // 5. VERIFY CONTENT
            // =================================================

            const verifiedPage =
                await verifyPage(
                    wpPage.id
                );

            const savedContent =
                verifiedPage.content?.raw || '';


            if (
                !savedContent.includes(
                    'Live Coverage Index'
                )
            ) {

                throw new Error(
                    'WordPress page was updated but "Live Coverage Index" was not found in the saved content.'
                );
            }


            console.log(
                '[+] WordPress content verified successfully.'
            );


            const liveUrl =
                verifiedPage.link;


            // =================================================
            // 6. GOOGLE AUTHENTICATION
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
                    'Google authentication failed: no access token.'
                );
            }


            console.log(
                '[+] Google authentication successful.'
            );


            // =================================================
            // 7. GOOGLE INDEXING API
            // =================================================

            console.log(
                '[i] URL being submitted to Google:',
                liveUrl
            );

            console.log(
                '[i] Target URL displayed on page:',
                targetUrl
            );


            const indexing =
                google.indexing({

                    version:
                        'v3',

                    auth:
                        authClient
                });


            const googleResponse =
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
                '[+] Google API response:',
                googleResponse.data
            );


            // =================================================
            // 8. SUCCESS
            // =================================================

            return res.status(200).json({

                success:
                    true,

                message:
                    'WordPress page updated, content verified, and Google Indexing API notification completed.',

                pageId:
                    verifiedPage.id,

                wordpressUrl:
                    liveUrl,

                pageSlug:
                    verifiedPage.slug,

                targetUrl:
                    targetUrl,

                targetDisplayedOnPage:
                    true,

                contentVerified:
                    true,

                savedContentLength:
                    savedContent.length,

                submittedToGoogle:
                    liveUrl,

                googleApiResponse:
                    googleResponse.data
            });


        } catch (error) {

            console.error(
                '[-] Indexing engine failure:',
                error
            );

            return res.status(500).json({

                success:
                    false,

                error:
                    'Internal indexing engine error.',

                details:
                    error.message
            });
        }
    }
);


// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    () => {

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
    }
);
