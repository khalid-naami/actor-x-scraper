/**
 * Apify Actor: X (Twitter) Ultimate All-in-One Scraper (Enterprise Edition)
 * Technology: JavaScript (ES Modules), Crawlee, Playwright + GraphQL Response Interception
 */

import { Actor } from 'apify';
import { PlaywrightCrawler, RequestQueue, log } from 'crawlee';
import {
    normalizeXUrl,
    detectXUrlType,
    parseNumericCount,
    extractLeadsFromText,
    extractGraphqlEntities,
    dismissXLoginModal,
    extractUserProfile,
    extractTweetsFromTimeline,
    extractTweetReplies,
    extractTrendingTopics,
    extractUserCells,
    resolveUserId,
    sanitizeRecord,
} from './extractors.js';

function isProxyTransportError(errOrStatus) {
    const msg = String(errOrStatus?.message || errOrStatus || '');
    return errOrStatus === 597 || errOrStatus === 407 || /597|UPSTREAM407|407|Proxy responded with|tunneling socket/i.test(msg);
}

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const {
        scrapeMode = 'AUTO_DETECT',
        targetUrls = [{ url: 'https://x.com/elonmusk' }],
        searchQueries = [],
        maxTweets = 20,
        maxRepliesPerTweet = 10,
        extractEmailAndPhone = true,
        proxyConfiguration: proxyInput,
        customCookies = '',
    } = input;

    const safeMaxTweets = Math.max(1, Math.min(500, Number(maxTweets) || 20));
    const safeMaxReplies = Math.max(0, Math.min(100, Number(maxRepliesPerTweet) || 10));

    log.info(`🚀 Starting X (Twitter) Ultimate Scraper | Mode: ${scrapeMode} | Targets: ${Array.isArray(targetUrls) ? targetUrls.length : 0}`);

    const targets = [];
    const targetList = Array.isArray(targetUrls) ? targetUrls : [];
    for (const item of targetList) {
        const rawUrl = typeof item === 'string' ? item : item?.url;
        if (rawUrl) {
            const normalized = normalizeXUrl(rawUrl);
            if (normalized) targets.push(normalized);
        }
    }
    const queryList = Array.isArray(searchQueries) ? searchQueries : [];
    for (const query of queryList) {
        if (query && typeof query === 'string' && query.trim()) {
            const encoded = encodeURIComponent(query.trim());
            targets.push(`https://x.com/search?q=${encoded}&f=live`);
        }
    }

    if (targets.length === 0) {
        targets.push('https://x.com/elonmusk');
    }

    let proxyConfiguration;
    try {
        if (proxyInput) {
            proxyConfiguration = await Actor.createProxyConfiguration(proxyInput);
        } else {
            proxyConfiguration = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] }).catch(() => undefined);
        }
    } catch (proxyErr) {
        log.warning(`⚠️ Proxy configuration skipped (${proxyErr.message}). Continuing directly.`);
    }

    function parseCookieString(raw) {
        if (!raw || typeof raw !== 'string' || !raw.trim()) return [];
        const trimmed = raw.trim();
        let rawList = [];
        if (trimmed.startsWith('[')) {
            rawList = JSON.parse(trimmed);
        } else {
            rawList = trimmed.split(';').map((pair) => {
                const eqIdx = pair.indexOf('=');
                if (eqIdx <= 0) return null;
                return {
                    name: pair.slice(0, eqIdx).trim(),
                    value: pair.slice(eqIdx + 1).trim(),
                };
            }).filter(Boolean);
        }

        const out = [];
        for (const c of rawList) {
            if (!c?.name || c?.value === undefined) continue;
            const sameSiteRaw = String(c.sameSite || '').toLowerCase();
            const sameSite = sameSiteRaw === 'no_restriction' || sameSiteRaw === 'none'
                ? 'None'
                : (sameSiteRaw === 'strict' ? 'Strict' : 'Lax');
            out.push({
                name: String(c.name),
                value: String(c.value),
                domain: c.domain || '.x.com',
                path: c.path || '/',
                secure: sameSite === 'None' ? true : Boolean(c.secure ?? true),
                sameSite,
            });
        }
        return out;
    }

    const scrapedRecords = [];
    const diagnostics = [];
    const queueName = `x-scraper-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const requestQueue = await RequestQueue.open(queueName);

    try {
        const crawler = new PlaywrightCrawler({
            maxConcurrency: 2,
            requestQueue,
            proxyConfiguration,
            maxRequestRetries: 2,
            requestHandlerTimeoutSecs: 90,
            navigationTimeoutSecs: 50,
            headless: true,

            launchContext: {
                launchOptions: {
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-blink-features=AutomationControlled',
                        '--disable-infobars',
                        '--window-size=1280,850',
                    ],
                },
            },

            preNavigationHooks: [
                async ({ page, context }, gotoOptions) => {
                    gotoOptions.waitUntil = 'domcontentloaded';

                    // Reset GraphQL capture bag per request and attach listener once per Page instance
                    page._xGraphqlBag = { users: new Map(), tweets: new Map() };
                    if (!page._hasXGraphqlListener) {
                        page._hasXGraphqlListener = true;
                        page.on('response', async (response) => {
                            try {
                                const resUrl = response.url();
                                if (!resUrl.includes('/i/api/graphql/')) return;
                                if (response.status() !== 200) return;
                                const ct = response.headers()['content-type'] || '';
                                if (!ct.includes('application/json')) return;
                                const json = await response.json().catch(() => null);
                                if (json && page._xGraphqlBag) {
                                    extractGraphqlEntities(json, page._xGraphqlBag);
                                }
                            } catch {
                                // ignore transient response parsing errors
                            }
                        });
                    }

                    await page.setExtraHTTPHeaders({
                        'accept-language': 'en-US,en;q=0.9',
                    });

                    if (customCookies && typeof customCookies === 'string' && customCookies.trim()) {
                        try {
                            const parsedCookies = parseCookieString(customCookies);
                            if (parsedCookies.length > 0) {
                                await context.addCookies(parsedCookies);
                            }
                        } catch (cookieErr) {
                            log.warning(`⚠️ Failed to parse customCookies: ${cookieErr.message}`);
                        }
                    }

                    // Abort large media downloads while keeping JSON/HTML/Images
                    await page.route('**/*.{mp4,webm,avi,woff,woff2}', (route) => route.abort());
                },
            ],

            async requestHandler({ page, request }) {
                const url = request.url;
                const activeMode = detectXUrlType(url, scrapeMode);
                log.info(`🔎 Scraping X [${activeMode}]: ${url}`);

                await page.waitForSelector('div[data-testid="UserName"], article[data-testid="tweet"], div[data-testid="trend"]', { timeout: 10000 }).catch(() => {});
                await page.waitForTimeout(2000);
                await dismissXLoginModal(page);

                if (['USER_PROFILES', 'USER_TWEETS', 'ADVANCED_SEARCH', 'HASHTAGS_TRENDS', 'USER_LIKES', 'FOLLOWERS_FOLLOWING', 'LISTS', 'COMMUNITIES'].includes(activeMode)) {
                    const scrollSteps = activeMode === 'USER_PROFILES' ? 2 : Math.min(8, Math.max(3, Math.ceil(safeMaxTweets / 5)));
                    log.info('📜 Scrolling page to load recent tweets and timeline items...');
                    for (let i = 0; i < scrollSteps; i++) {
                        await page.mouse.wheel(0, 1000);
                        await page.waitForTimeout(1000);
                        await dismissXLoginModal(page);
                    }
                }

                const bag = page._xGraphqlBag || { users: new Map(), tweets: new Map() };
                const pushClean = async (rec) => {
                    const cleaned = sanitizeRecord({
                        ...rec,
                        scrapedAt: rec.scrapedAt || new Date().toISOString(),
                    });
                    await Actor.pushData(cleaned);
                    scrapedRecords.push(cleaned);
                    return cleaned;
                };

                if (activeMode === 'USER_PROFILES') {
                    const domProfile = await extractUserProfile(page, url);
                    const handleFromUrl = url.match(/x\.com\/([a-zA-Z0-9_]+)/i)?.[1] || domProfile.username;
                    const gqlProfile = handleFromUrl ? bag.users.get(handleFromUrl.toLowerCase()) : null;

                    const mergedBiography = gqlProfile?.biography || domProfile.biography;
                    const mergedLocation = gqlProfile?.location || domProfile.location;
                    const leads = extractEmailAndPhone
                        ? extractLeadsFromText(`${mergedBiography || ''} ${mergedLocation || ''}`)
                        : { email: undefined, phone: undefined };

                    // Combine GraphQL tweets + DOM tweets cleanly without nulls
                    const gqlTweets = Array.from(bag.tweets.values());
                    const domTweets = await extractTweetsFromTimeline(page, Math.min(safeMaxTweets, 10));
                    const mergedTweetMap = new Map();
                    for (const t of [...gqlTweets, ...domTweets]) {
                        if (t?.id && !mergedTweetMap.has(t.id)) {
                            mergedTweetMap.set(t.id, t);
                        }
                    }
                    const recentTweets = Array.from(mergedTweetMap.values()).slice(0, Math.min(safeMaxTweets, 10));

                    const followingCount = gqlProfile?.followingCount ?? parseNumericCount(domProfile.followingRaw);
                    const followersCount = gqlProfile?.followersCount ?? parseNumericCount(domProfile.followersRaw);

                    const profileRecord = sanitizeRecord({
                        type: 'USER_PROFILE',
                        id: gqlProfile?.id || domProfile.id,
                        url: gqlProfile?.url || domProfile.url,
                        username: gqlProfile?.username || domProfile.username || handleFromUrl,
                        name: gqlProfile?.name || domProfile.name || handleFromUrl,
                        biography: mergedBiography,
                        location: mergedLocation,
                        website: gqlProfile?.website || domProfile.website,
                        joinedDate: gqlProfile?.joinedDate || domProfile.joinedDate,
                        followersCount,
                        followingCount,
                        tweetsCount: gqlProfile?.tweetsCount,
                        isVerified: Boolean(gqlProfile?.isVerified || domProfile.isVerified),
                        avatarUrl: gqlProfile?.avatarUrl || domProfile.avatarUrl,
                        bannerUrl: gqlProfile?.bannerUrl || domProfile.bannerUrl,
                        email: leads.email,
                        phone: leads.phone,
                        recentTweets: recentTweets.length > 0 ? recentTweets : undefined,
                        scrapedAt: new Date().toISOString(),
                    });

                    if (!profileRecord.username && !profileRecord.name && !profileRecord.id) {
                        throw new Error(`Unable to extract profile data for ${url} (possible login wall — provide customCookies or Residential Proxy)`);
                    }

                    log.info(`✅ Successfully scraped [USER_PROFILES] from: ${url} (@${profileRecord.username})`);
                    await pushClean(profileRecord);
                } else if (['USER_TWEETS', 'ADVANCED_SEARCH', 'USER_LIKES', 'LISTS', 'COMMUNITIES', 'SPACES'].includes(activeMode)) {
                    let searchQuery;
                    try {
                        searchQuery = new URL(url).searchParams.get('q') || undefined;
                    } catch {
                        // ignore
                    }

                    const gqlTweets = Array.from(bag.tweets.values());
                    const domTweets = await extractTweetsFromTimeline(page, safeMaxTweets);
                    const combinedMap = new Map();
                    for (const t of [...gqlTweets, ...domTweets]) {
                        if (t?.id && !combinedMap.has(t.id)) {
                            combinedMap.set(t.id, t);
                        }
                    }
                    const tweetsList = Array.from(combinedMap.values()).slice(0, safeMaxTweets);

                    if (tweetsList.length === 0) {
                        throw new Error(`No tweets visible for ${url} (X may require customCookies for this feed/search)`);
                    }

                    for (const t of tweetsList) {
                        await pushClean({
                            ...t,
                            sourceUrl: url,
                            searchQuery,
                        });
                    }
                    log.info(`✅ Successfully scraped [${activeMode}] (${tweetsList.length} tweets) from: ${url}`);
                } else if (activeMode === 'TWEET_REPLIES') {
                    const gqlTweets = Array.from(bag.tweets.values());
                    const mainDomTweets = await extractTweetsFromTimeline(page, 1);
                    const repliesDom = await extractTweetReplies(page, safeMaxReplies);

                    const combined = new Map();
                    for (const t of [...gqlTweets, ...mainDomTweets]) {
                        if (t?.id && !combined.has(t.id)) combined.set(t.id, t);
                    }
                    const allItems = [...combined.values()];
                    if (allItems.length === 0 && repliesDom.length === 0) {
                        throw new Error(`Unable to extract tweet or replies for ${url}`);
                    }
                    if (allItems[0]) {
                        await pushClean({ ...allItems[0], sourceUrl: url });
                    }
                    const repliesToSave = allItems.length > 1
                        ? allItems.slice(1, safeMaxReplies + 1).map((r) => ({ ...r, type: 'REPLY', sourceUrl: url }))
                        : repliesDom.map((r) => ({ ...r, sourceUrl: url }));
                    for (const r of repliesToSave) {
                        await pushClean(r);
                    }
                    log.info(`✅ Successfully scraped [TWEET_REPLIES] (${repliesToSave.length} replies) from: ${url}`);
                } else if (activeMode === 'HASHTAGS_TRENDS') {
                    const trends = await extractTrendingTopics(page);
                    const domTweets = await extractTweetsFromTimeline(page, safeMaxTweets);
                    const allTweets = [...bag.tweets.values(), ...domTweets];

                    if (trends.length === 0 && allTweets.length === 0) {
                        throw new Error(`No trends or hashtag tweets extracted from ${url}`);
                    }
                    for (const tr of trends) {
                        await pushClean({ ...tr, sourceUrl: url });
                    }
                    const seen = new Set();
                    for (const tw of allTweets.slice(0, safeMaxTweets)) {
                        if (tw?.id && !seen.has(tw.id)) {
                            seen.add(tw.id);
                            await pushClean({ ...tw, sourceUrl: url });
                        }
                    }
                    log.info(`✅ Successfully scraped [HASHTAGS_TRENDS] from: ${url}`);
                } else if (activeMode === 'FOLLOWERS_FOLLOWING') {
                    const gqlUsers = Array.from(bag.users.values());
                    const domUsers = await extractUserCells(page, safeMaxTweets);
                    const merged = gqlUsers.length > 0 ? gqlUsers : domUsers;
                    if (merged.length === 0) {
                        throw new Error(`No followers/following visible for ${url} (X requires customCookies for follower lists)`);
                    }
                    for (const u of merged.slice(0, safeMaxTweets)) {
                        await pushClean({ ...u, sourceUrl: url });
                    }
                    log.info(`✅ Successfully scraped [FOLLOWERS_FOLLOWING] (${merged.length} accounts) from: ${url}`);
                } else if (activeMode === 'USER_ID_CONVERTER') {
                    const cleanHandle = url.split('/').filter(Boolean).pop().replace(/^@/, '');
                    const gqlUser = bag.users.get(cleanHandle.toLowerCase());
                    const resolved = gqlUser?.id
                        ? { type: 'USER_ID_CONVERTER', id: gqlUser.id, username: cleanHandle, name: gqlUser.name, url }
                        : await resolveUserId(page, cleanHandle);
                    if (!resolved.id) {
                        throw new Error(`Could not resolve numeric Rest ID for @${cleanHandle}`);
                    }
                    await pushClean(resolved);
                    log.info(`✅ Resolved @${cleanHandle} -> ID ${resolved.id}`);
                } else {
                    const domTweets = await extractTweetsFromTimeline(page, safeMaxTweets);
                    const allTweets = [...bag.tweets.values(), ...domTweets];
                    if (allTweets.length === 0) {
                        throw new Error(`No X content extracted from ${url}`);
                    }
                    for (const tw of allTweets.slice(0, safeMaxTweets)) {
                        await pushClean({ ...tw, sourceUrl: url });
                    }
                }
            },

            async failedRequestHandler({ request }, error) {
                const msg = error?.message || 'Unknown crawler error';
                log.error(`❌ Request ${request.url} failed: ${msg}`);
                diagnostics.push(`${request.url}: ${msg}`);
            },
        });

        await crawler.run(targets);
    } finally {
        await requestQueue.drop().catch(() => {});
    }

    const summary = {
        status: scrapedRecords.length > 0 ? 'COMPLETED' : 'FAILED',
        totalRecordsScraped: scrapedRecords.length,
        executionMode: scrapeMode,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        recordsSummary: scrapedRecords.map((r) => sanitizeRecord({
            type: r.type,
            id: r.id,
            url: r.url || r.sourceUrl,
            username: r.username,
            name: r.name,
            followers: r.followersCount,
            email: r.email,
            phone: r.phone,
        })),
        finishedAt: new Date().toISOString(),
    };

    await Actor.setValue('OUTPUT', summary);
    log.info(`🎉 Scraped ${scrapedRecords.length} X (Twitter) record(s). Data pushed to Dataset & OUTPUT Key-Value store.`);

    if (scrapedRecords.length === 0) {
        const reason = diagnostics.length > 0 ? diagnostics.join('; ') : 'No X records extracted (login wall or proxy limit).';
        await Actor.fail(`Extracted 0 X records. ${reason}`);
    }
} catch (fatalErr) {
    log.exception(fatalErr, '💥 Fatal error in X Ultimate Scraper');
    await Actor.fail(fatalErr.message);
} finally {
    await Actor.exit();
}
