/**
 * Apify Actor: X (Twitter) Ultimate All-in-One Scraper (Enterprise Edition)
 * Technology: JavaScript (ES Modules), Crawlee, Playwright
 * Handles stealth, incremental timeline scrolling, and deep metric extraction.
 */

import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';
import {
    normalizeXUrl,
    detectXUrlType,
    parseNumericCount,
    extractLeadsFromText,
    dismissXLoginModal,
    extractUserProfile,
    extractTweetsFromTimeline,
    extractTweetReplies,
    extractTrendingTopics,
    resolveUserId
} from './extractors.js';

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
        customCookies = ''
    } = input;

    log.info(`🚀 Starting X (Twitter) Ultimate Scraper | Mode: ${scrapeMode} | Targets: ${targetUrls.length}`);

    // Build target URLs list
    const targets = [];
    for (const item of targetUrls) {
        const rawUrl = typeof item === 'string' ? item : item.url;
        if (rawUrl) targets.push(normalizeXUrl(rawUrl));
    }
    for (const query of searchQueries) {
        if (query && typeof query === 'string') {
            const encoded = encodeURIComponent(query.trim());
            targets.push(`https://x.com/search?q=${encoded}&f=live`);
        }
    }

    if (targets.length === 0) {
        targets.push('https://x.com/elonmusk');
    }

    // Setup Apify Residential Proxy
    let proxyConfiguration;
    if (proxyInput) {
        proxyConfiguration = await Actor.createProxyConfiguration(proxyInput);
    } else {
        proxyConfiguration = await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL']
        }).catch(() => undefined);
    }

    const scrapedRecords = [];

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 85,
        navigationTimeoutSecs: 50,
        headless: true,

        launchContext: {
            launchOptions: {
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--window-size=1280,850'
                ]
            }
        },

        preNavigationHooks: [
            async ({ page, context }) => {
                await page.setExtraHTTPHeaders({
                    'accept-language': 'en-US,en;q=0.9',
                    'sec-ch-ua': '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"'
                });

                // Apply custom session cookies
                if (customCookies && typeof customCookies === 'string') {
                    try {
                        let parsedCookies = [];
                        if (customCookies.trim().startsWith('[')) {
                            parsedCookies = JSON.parse(customCookies);
                        } else {
                            parsedCookies = customCookies.split(';').map((pair) => {
                                const [name, ...val] = pair.trim().split('=');
                                return {
                                    name: name.trim(),
                                    value: val.join('=').trim(),
                                    domain: '.x.com',
                                    path: '/'
                                };
                            }).filter(c => c.name && c.value);
                        }
                        if (parsedCookies.length > 0) {
                            await context.addCookies(parsedCookies);
                            log.info(`🔑 Applied ${parsedCookies.length} X session cookies.`);
                        }
                    } catch (cookieErr) {
                        log.warning(`Failed to parse custom cookies: ${cookieErr.message}`);
                    }
                }

                // Block streaming video downloads to save bandwidth and compute
                await page.route('**/*.{mp4,webm,avi,woff,woff2}', (route) => route.abort());
            }
        ],

        async requestHandler({ page, request }) {
            const url = request.url;
            const activeMode = scrapeMode === 'AUTO_DETECT' ? detectXUrlType(url) : scrapeMode;
            log.info(`🔎 Scraping X [${activeMode}]: ${url}`);

            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(3000);

            // Dismiss login popups
            await dismissXLoginModal(page);

            // Incremental scroll for timelines and search results
            if (['USER_PROFILES', 'USER_TWEETS', 'ADVANCED_SEARCH', 'HASHTAGS_TRENDS', 'USER_LIKES'].includes(activeMode)) {
                log.info('📜 Scrolling page to load recent tweets and timeline items...');
                for (let i = 0; i < 3; i++) {
                    await page.mouse.wheel(0, 900);
                    await page.waitForTimeout(1000);
                    await dismissXLoginModal(page);
                }
            }

            let resultRecord = null;

            switch (activeMode) {
                case 'USER_PROFILES': {
                    const profileData = await extractUserProfile(page, url);
                    const leads = extractEmailAndPhone ? extractLeadsFromText(profileData.biography) : { email: null, phone: null };
                    const recentTweets = await extractTweetsFromTimeline(page, Math.min(maxTweets, 5));

                    resultRecord = {
                        ...profileData,
                        followingCount: parseNumericCount(profileData.followingRaw),
                        followersCount: parseNumericCount(profileData.followersRaw),
                        email: leads.email,
                        phone: leads.phone,
                        recentTweets,
                        scrapedAt: new Date().toISOString()
                    };
                    break;
                }
                case 'USER_TWEETS':
                case 'ADVANCED_SEARCH': {
                    const tweetsList = await extractTweetsFromTimeline(page, maxTweets);
                    resultRecord = {
                        type: activeMode === 'ADVANCED_SEARCH' ? 'SEARCH_RESULTS' : 'USER_TWEETS',
                        sourceUrl: url,
                        totalTweetsCollected: tweetsList.length,
                        tweets: tweetsList.map(t => ({
                            ...t,
                            repliesCount: parseNumericCount(t.repliesRaw),
                            retweetsCount: parseNumericCount(t.retweetsRaw),
                            likesCount: parseNumericCount(t.likesRaw),
                            viewsCount: parseNumericCount(t.viewsRaw)
                        })),
                        scrapedAt: new Date().toISOString()
                    };
                    break;
                }
                case 'TWEET_REPLIES': {
                    const mainTweets = await extractTweetsFromTimeline(page, 1);
                    const replies = await extractTweetReplies(page, maxRepliesPerTweet);
                    resultRecord = {
                        type: 'TWEET_CONVERSATION',
                        tweetUrl: url,
                        mainTweet: mainTweets[0] || null,
                        repliesCount: replies.length,
                        replies: replies.map(r => ({
                            ...r,
                            likesCount: parseNumericCount(r.likesRaw)
                        })),
                        scrapedAt: new Date().toISOString()
                    };
                    break;
                }
                case 'HASHTAGS_TRENDS': {
                    const trends = await extractTrendingTopics(page);
                    const tweets = await extractTweetsFromTimeline(page, maxTweets);
                    resultRecord = {
                        type: 'HASHTAG_OR_TRENDS',
                        url,
                        trends,
                        tweets,
                        scrapedAt: new Date().toISOString()
                    };
                    break;
                }
                case 'USER_ID_CONVERTER': {
                    const handle = url.split('/').pop().replace('@', '');
                    resultRecord = {
                        ...(await resolveUserId(page, handle)),
                        scrapedAt: new Date().toISOString()
                    };
                    break;
                }
                default: {
                    const tweets = await extractTweetsFromTimeline(page, maxTweets);
                    resultRecord = {
                        type: 'X_GENERIC',
                        url,
                        title: await page.title(),
                        tweetsCount: tweets.length,
                        tweets,
                        scrapedAt: new Date().toISOString()
                    };
                }
            }

            if (resultRecord) {
                log.info(`✅ Successfully scraped [${activeMode}] from: ${url}`);
                await Actor.pushData(resultRecord);
                scrapedRecords.push(resultRecord);
            }
        },

        async failedRequestHandler({ request, error }) {
            log.error(`❌ Request ${request.url} failed: ${error.message}`);
        }
    });

    await crawler.run(targets);

    // Save summary in Key-Value store
    const summary = {
        totalRecordsScraped: scrapedRecords.length,
        executionMode: scrapeMode,
        recordsSummary: scrapedRecords.map((r) => ({
            type: r.type,
            url: r.url || r.sourceUrl || r.tweetUrl,
            username: r.username || r.authorHandle,
            name: r.name || r.authorName,
            followers: r.followersCount,
            email: r.email,
            phone: r.phone
        })),
        finishedAt: new Date().toISOString()
    };

    await Actor.setValue('OUTPUT', summary);
    log.info(`🎉 Scraped ${scrapedRecords.length} X (Twitter) record(s). Data pushed to Dataset & OUTPUT Key-Value store.`);

} catch (error) {
    log.error(`Actor failed: ${error.message}`, { stack: error.stack });
    throw error;
} finally {
    await Actor.exit();
}
