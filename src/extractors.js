/**
 * X (Twitter) Ultimate All-in-One Extractors
 * Covers DOM + GraphQL JSON extraction across Profiles, Tweets, Replies, Search,
 * Media/MP4 Videos, Trends, Followers/Following, Likes, Lists, Communities, Spaces & User ID lookup.
 */

export function sanitizeRecord(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => sanitizeRecord(item))
            .filter((item) => item !== null && item !== undefined && !(typeof item === 'number' && !Number.isFinite(item)));
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === null || v === undefined) continue;
            if (typeof v === 'number' && !Number.isFinite(v)) continue;
            if (Array.isArray(v)) {
                out[k] = sanitizeRecord(v);
            } else if (typeof v === 'object') {
                out[k] = sanitizeRecord(v);
            } else {
                out[k] = v;
            }
        }
        return out;
    }
    return value;
}

/**
 * Normalizes input targets (handles @elonmusk -> https://x.com/elonmusk).
 */
export function normalizeXUrl(input) {
    if (!input) return '';
    let url = String(input).trim();
    if (!url.startsWith('http')) {
        if (url.startsWith('#')) {
            url = `https://x.com/hashtag/${encodeURIComponent(url.slice(1))}`;
        } else {
            const handle = url.replace(/^@/, '');
            url = `https://x.com/${encodeURIComponent(handle)}`;
        }
    }
    return url.replace(/^https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)/i, 'https://x.com');
}

/**
 * Detects X URL type automatically from URL structure, respecting explicit mode for profile URLs.
 */
export function detectXUrlType(url, explicitMode = 'AUTO_DETECT') {
    if (!url) return explicitMode && explicitMode !== 'AUTO_DETECT' ? explicitMode : 'USER_PROFILES';
    const lower = url.toLowerCase();

    if (lower.includes('/status/')) return 'TWEET_REPLIES';
    if (lower.includes('/search') || lower.includes('?q=') || lower.includes('&q=')) return 'ADVANCED_SEARCH';
    if (lower.includes('/hashtag/') || lower.includes('/explore')) return 'HASHTAGS_TRENDS';
    if (lower.includes('/followers') || lower.includes('/following') || lower.includes('/verified_followers')) return 'FOLLOWERS_FOLLOWING';
    if (lower.includes('/likes')) return 'USER_LIKES';
    if (lower.includes('/i/lists/') || lower.includes('/lists')) return 'LISTS';
    if (lower.includes('/i/communities/')) return 'COMMUNITIES';
    if (lower.includes('/i/spaces/')) return 'SPACES';

    if (explicitMode && explicitMode !== 'AUTO_DETECT') return explicitMode;
    return 'USER_PROFILES';
}

/**
 * Parses numeric counts with K, M, B abbreviations (e.g. "1.2M", "45.5K").
 * Returns integer or undefined (never null).
 */
export function parseNumericCount(val) {
    if (val === null || val === undefined || val === '') return undefined;
    if (typeof val === 'number') {
        return Number.isFinite(val) ? Math.trunc(val) : undefined;
    }
    const clean = String(val).replace(/,/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return undefined;
    const match = clean.match(/([\d.]+)\s*([KkMmBb])?/);
    if (!match) return undefined;

    let num = Number.parseFloat(match[1]);
    if (!Number.isFinite(num)) return undefined;
    const multiplier = match[2]?.toUpperCase();

    if (multiplier === 'K') num *= 1_000;
    else if (multiplier === 'M') num *= 1_000_000;
    else if (multiplier === 'B') num *= 1_000_000_000;

    return Math.round(num);
}

/**
 * Extracts business email and phone leads from text.
 */
export function extractLeadsFromText(text) {
    if (!text || typeof text !== 'string') return { email: undefined, phone: undefined };

    let email;
    const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7}\b/);
    if (emailMatch && !emailMatch[0].toLowerCase().includes('x.com') && !emailMatch[0].toLowerCase().includes('twitter.com')) {
        email = emailMatch[0].toLowerCase();
    }

    let phone;
    const phoneMatch = text.match(/(?:\+?\d{1,4}[ -]?)?\(?\d{2,4}\)?[ -]?\d{3,4}[ -]?\d{3,5}/);
    if (phoneMatch) {
        const digits = phoneMatch[0].replace(/\D/g, '');
        if (digits.length >= 8 && digits.length <= 15) {
            phone = phoneMatch[0].trim();
        }
    }

    return { email, phone };
}

function unwrapTweetResult(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.__typename === 'TweetWithVisibilityResults' && raw.tweet) return raw.tweet;
    if (raw.tweet && raw.tweet.legacy) return raw.tweet;
    if (raw.legacy || raw.rest_id) return raw;
    return null;
}

function unwrapUserResult(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.__typename === 'User' && (raw.legacy || raw.rest_id)) return raw;
    if (raw.result && raw.result.__typename === 'User') return raw.result;
    return null;
}

/**
 * Parses a GraphQL User node into normalized profile object.
 */
export function normalizeGraphqlUser(userNode) {
    const u = unwrapUserResult(userNode) || userNode;
    if (!u || typeof u !== 'object') return null;
    const leg = u.legacy || {};
    const username = leg.screen_name || u.core?.screen_name;
    const restId = u.rest_id ? String(u.rest_id) : undefined;
    if (!username && !restId) return null;

    const expandedWebsite = leg.entities?.url?.urls?.[0]?.expanded_url || leg.url || undefined;
    return sanitizeRecord({
        type: 'USER_PROFILE',
        id: restId,
        url: username ? `https://x.com/${username}` : undefined,
        username,
        name: leg.name || u.core?.name || username,
        biography: leg.description || undefined,
        location: leg.location || undefined,
        website: expandedWebsite,
        joinedDate: leg.created_at || undefined,
        followersCount: parseNumericCount(leg.followers_count),
        followingCount: parseNumericCount(leg.friends_count),
        tweetsCount: parseNumericCount(leg.statuses_count),
        isVerified: Boolean(u.is_blue_verified || leg.verified),
        avatarUrl: leg.profile_image_url_https ? String(leg.profile_image_url_https).replace('_normal.', '_400x400.') : undefined,
        bannerUrl: leg.profile_banner_url || undefined,
    });
}

/**
 * Parses a GraphQL Tweet node into normalized tweet object (including full note_tweet & direct MP4 URLs).
 */
export function normalizeGraphqlTweet(tweetNode) {
    const tw = unwrapTweetResult(tweetNode);
    if (!tw || !tw.legacy) return null;
    const leg = tw.legacy;
    const tweetId = tw.rest_id || leg.id_str;
    if (!tweetId) return null;

    const userRaw = tw.core?.user_results?.result;
    const userLeg = userRaw?.legacy || {};
    const username = userLeg.screen_name || userRaw?.core?.screen_name || undefined;
    const name = userLeg.name || userRaw?.core?.name || username;

    const fullText = tw.note_tweet?.note_tweet_results?.result?.text || leg.full_text || '';
    const mediaEntities = leg.extended_entities?.media || leg.entities?.media || [];

    const mediaUrls = [];
    const videoUrls = [];
    let isVideo = false;

    for (const m of mediaEntities) {
        if (m.media_url_https) mediaUrls.push(m.media_url_https);
        if (m.video_info?.variants) {
            isVideo = true;
            const mp4Variants = m.video_info.variants
                .filter((v) => v.content_type === 'video/mp4' && v.url)
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            if (mp4Variants[0]?.url) videoUrls.push(mp4Variants[0].url);
        }
    }

    const hashtags = (leg.entities?.hashtags || []).map((h) => `#${h.text}`);
    const mentions = (leg.entities?.user_mentions || []).map((u) => `@${u.screen_name}`);

    return sanitizeRecord({
        type: 'TWEET',
        id: String(tweetId),
        url: username ? `https://x.com/${username}/status/${tweetId}` : `https://x.com/i/web/status/${tweetId}`,
        username,
        name,
        text: fullText,
        likesCount: parseNumericCount(leg.favorite_count) ?? 0,
        retweetsCount: parseNumericCount(leg.retweet_count) ?? 0,
        repliesCount: parseNumericCount(leg.reply_count) ?? 0,
        quotesCount: parseNumericCount(leg.quote_count) ?? 0,
        viewsCount: parseNumericCount(tw.views?.count),
        bookmarksCount: parseNumericCount(leg.bookmark_count),
        isVideo,
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        videoUrls: videoUrls.length > 0 ? videoUrls : undefined,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
        timestamp: leg.created_at ? new Date(leg.created_at).toISOString() : undefined,
    });
}

function mergeUserIntoBag(usersMap, nextUser) {
    if (!nextUser?.username) return;
    const key = nextUser.username.toLowerCase();
    const prev = usersMap.get(key);
    usersMap.set(key, prev ? sanitizeRecord({ ...prev, ...nextUser }) : nextUser);
}

/**
 * Recursively collects User and Tweet objects from intercepted X GraphQL responses.
 */
export function extractGraphqlEntities(payload, bag = { users: new Map(), tweets: new Map() }) {
    if (!payload || typeof payload !== 'object') return bag;

    if (Array.isArray(payload)) {
        for (const item of payload) extractGraphqlEntities(item, bag);
        return bag;
    }

    if (payload.__typename === 'User' && (payload.legacy || payload.rest_id)) {
        const normUser = normalizeGraphqlUser(payload);
        mergeUserIntoBag(bag.users, normUser);
    }

    if (payload.tweet_results?.result) {
        const normTweet = normalizeGraphqlTweet(payload.tweet_results.result);
        if (normTweet?.id) {
            bag.tweets.set(normTweet.id, normTweet);
        }
        // Also collect author user without overwriting richer profile metadata
        const authorNode = payload.tweet_results.result.core?.user_results?.result
            || payload.tweet_results.result.tweet?.core?.user_results?.result;
        if (authorNode) {
            const normAuthor = normalizeGraphqlUser(authorNode);
            mergeUserIntoBag(bag.users, normAuthor);
        }
    }

    for (const val of Object.values(payload)) {
        if (val && typeof val === 'object') {
            extractGraphqlEntities(val, bag);
        }
    }
    return bag;
}

/**
 * Dismisses bottom login banners and modals on X.
 */
export async function dismissXLoginModal(page) {
    try {
        await page.evaluate(() => {
            const layers = document.querySelectorAll('div[data-testid="sheetDialog"], div[role="dialog"], div[data-testid="BottomBar"]');
            layers.forEach((l) => {
                const text = l.innerText || '';
                if (
                    text.includes('Sign in')
                    || text.includes('Log in')
                    || text.includes('Don’t miss what’s happening')
                    || text.includes("Don't miss what's happening")
                    || text.includes('تسجيل الدخول')
                ) {
                    l.remove();
                }
            });
            document.body.style.overflow = 'auto';
            document.documentElement.style.overflow = 'auto';
        });

        const closeBtn = page.locator('div[data-testid="app-bar-close"], [aria-label="Close"], [aria-label="Fermer"]').first();
        if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
            await closeBtn.click().catch(() => {});
        }
    } catch {
        // Silently continue
    }
}

// ==================== 1. USER PROFILES DOM EXTRACTOR ====================
export async function extractUserProfile(page, url) {
    return page.evaluate((canonicalUrl) => {
        let name = '';
        let username = '';
        let bio = '';
        let location = '';
        let website = '';
        let joinedDate = '';
        let followingRaw;
        let followersRaw;
        let isVerified = false;
        let avatarUrl = '';
        let bannerUrl = '';

        const headerName = document.querySelector('div[data-testid="UserName"]');
        if (headerName) {
            const lines = (headerName.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
            name = lines[0] || '';
            const handleLine = lines.find((l) => l.startsWith('@'));
            username = handleLine ? handleLine.replace(/^@/, '') : (lines[1] ? lines[1].replace(/^@/, '') : '');
        }

        // Title fallback e.g. "OpenAI (@OpenAI) / X"
        if ((!name || !username) && document.title) {
            const m = document.title.match(/^(.+?)\s*\(@([a-zA-Z0-9_]+)\)/);
            if (m) {
                if (!name) name = m[1].trim();
                if (!username) username = m[2].trim();
            }
        }
        if (!username) {
            const urlMatch = canonicalUrl.match(/x\.com\/([a-zA-Z0-9_]+)/i);
            if (urlMatch) username = urlMatch[1];
        }

        const bioElem = document.querySelector('div[data-testid="UserDescription"]');
        if (bioElem) bio = (bioElem.innerText || '').trim();

        const userHeader = document.querySelector('div[data-testid="UserProfileHeader_Items"]');
        if (userHeader) {
            const locElem = userHeader.querySelector('span[data-testid="UserLocation"]');
            if (locElem) location = (locElem.innerText || '').trim();

            const joinElem = userHeader.querySelector('span[data-testid="UserJoinDate"]');
            if (joinElem) joinedDate = (joinElem.innerText || '').trim();

            const linkElem = userHeader.querySelector('a[data-testid="UserUrl"]');
            if (linkElem) website = linkElem.getAttribute('href') || (linkElem.innerText || '').trim();
        }

        const followingElem = document.querySelector('a[href*="/following"] span');
        if (followingElem?.innerText?.trim()) followingRaw = followingElem.innerText.trim();

        const followersElem = document.querySelector('a[href*="/verified_followers"] span, a[href*="/followers"] span');
        if (followersElem?.innerText?.trim()) followersRaw = followersElem.innerText.trim();

        isVerified = Boolean(document.querySelector('svg[data-testid="icon-verified"]'));

        const avatarImg = document.querySelector('img[src*="profile_images"]');
        if (avatarImg) avatarUrl = avatarImg.getAttribute('src') || '';

        const bannerImg = document.querySelector('img[src*="profile_banners"]');
        if (bannerImg) bannerUrl = bannerImg.getAttribute('src') || '';

        // Try extracting rest_id from banner/avatar/HTML
        const html = document.documentElement?.innerHTML || '';
        const idMatch = bannerUrl.match(/profile_banners\/(\d+)\//)
            || html.match(/profile_banners\/(\d+)\//)
            || html.match(/"rest_id":"(\d+)"/);

        return {
            type: 'USER_PROFILE',
            id: idMatch ? idMatch[1] : undefined,
            url: canonicalUrl,
            username: username || undefined,
            name: name || username || undefined,
            biography: bio || undefined,
            location: location || undefined,
            website: website || undefined,
            joinedDate: joinedDate || undefined,
            followingRaw,
            followersRaw,
            isVerified,
            avatarUrl: avatarUrl || undefined,
            bannerUrl: bannerUrl || undefined,
        };
    }, url);
}

// ==================== 2. TWEETS & TIMELINE DOM EXTRACTOR ====================
export async function extractTweetsFromTimeline(page, maxTweets = 20) {
    const rawTweets = await page.evaluate((max) => {
        const tweetElements = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, max);
        return tweetElements.map((tw) => {
            const textElem = tw.querySelector('div[data-testid="tweetText"]');
            const text = textElem ? textElem.innerText.trim() : '';

            const userElem = tw.querySelector('div[data-testid="User-Name"]');
            const userLines = userElem ? userElem.innerText.split('\n').map((l) => l.trim()).filter(Boolean) : [];
            const name = userLines[0] || '';
            const handleLine = userLines.find((l) => l.startsWith('@'));
            const username = handleLine ? handleLine.replace(/^@/, '') : (userLines[1] || '').replace(/^@/, '');

            const timeElem = tw.querySelector('time');
            const timestamp = timeElem ? timeElem.getAttribute('datetime') : undefined;
            const linkElem = timeElem?.closest('a');
            const href = linkElem ? linkElem.getAttribute('href') : '';
            const tweetUrl = href ? `https://x.com${href}` : undefined;
            const tweetIdMatch = (href || '').match(/status\/(\d+)/);
            const id = tweetIdMatch ? tweetIdMatch[1] : undefined;

            const repliesRaw = tw.querySelector('button[data-testid="reply"]')?.innerText?.trim() || '0';
            const retweetsRaw = tw.querySelector('button[data-testid="retweet"]')?.innerText?.trim() || '0';
            const likesRaw = tw.querySelector('button[data-testid="like"]')?.innerText?.trim() || '0';
            const viewsRaw = tw.querySelector('a[href*="/analytics"]')?.innerText?.trim() || undefined;

            const mediaImgs = Array.from(tw.querySelectorAll('img[src*="media"], img[src*="ext_tw_video_thumb"]'))
                .map((img) => img.getAttribute('src'))
                .filter(Boolean);

            const video = tw.querySelector('video');
            const isVideo = Boolean(video);
            const videoSrc = video ? video.getAttribute('src') : undefined;
            const videoUrls = videoSrc && !videoSrc.startsWith('blob:') ? [videoSrc] : [];

            const hashtags = text.match(/#[a-zA-Z0-9_]+/g) || [];
            const mentions = text.match(/@[a-zA-Z0-9_]+/g) || [];

            return {
                id,
                url: tweetUrl,
                username: username || undefined,
                name: name || undefined,
                text,
                timestamp: timestamp || undefined,
                repliesRaw,
                retweetsRaw,
                likesRaw,
                viewsRaw,
                mediaUrls: mediaImgs,
                isVideo,
                videoUrls,
                hashtags,
                mentions,
            };
        }).filter((t) => (t.text && t.text.length > 0) || t.mediaUrls.length > 0);
    }, maxTweets);

    return rawTweets.map((t, idx) => sanitizeRecord({
        type: 'TWEET',
        id: t.id || `tweet-${idx + 1}`,
        url: t.url,
        username: t.username,
        name: t.name,
        text: t.text,
        likesCount: parseNumericCount(t.likesRaw) ?? 0,
        retweetsCount: parseNumericCount(t.retweetsRaw) ?? 0,
        repliesCount: parseNumericCount(t.repliesRaw) ?? 0,
        viewsCount: parseNumericCount(t.viewsRaw),
        isVideo: t.isVideo,
        mediaUrls: t.mediaUrls.length > 0 ? t.mediaUrls : undefined,
        videoUrls: t.videoUrls.length > 0 ? t.videoUrls : undefined,
        hashtags: t.hashtags.length > 0 ? t.hashtags : undefined,
        mentions: t.mentions.length > 0 ? t.mentions : undefined,
        timestamp: t.timestamp,
    }));
}

// ==================== 3. TWEET THREAD & REPLIES EXTRACTOR ====================
export async function extractTweetReplies(page, maxReplies = 15) {
    const rawReplies = await page.evaluate((max) => {
        const allArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
        const replies = allArticles.slice(1, max + 1);

        return replies.map((tw) => {
            const textElem = tw.querySelector('div[data-testid="tweetText"]');
            const text = textElem ? textElem.innerText.trim() : '';

            const userElem = tw.querySelector('div[data-testid="User-Name"]');
            const userLines = userElem ? userElem.innerText.split('\n').map((l) => l.trim()).filter(Boolean) : [];
            const name = userLines[0] || '';
            const handleLine = userLines.find((l) => l.startsWith('@'));
            const username = handleLine ? handleLine.replace(/^@/, '') : '';

            const timeElem = tw.querySelector('time');
            const timestamp = timeElem ? timeElem.getAttribute('datetime') : undefined;
            const href = timeElem?.closest('a')?.getAttribute('href') || '';
            const tweetIdMatch = href.match(/status\/(\d+)/);
            const likesRaw = tw.querySelector('button[data-testid="like"]')?.innerText?.trim() || '0';

            return {
                id: tweetIdMatch ? tweetIdMatch[1] : undefined,
                url: href ? `https://x.com${href}` : undefined,
                username: username || undefined,
                name: name || undefined,
                text,
                likesRaw,
                timestamp: timestamp || undefined,
            };
        }).filter((r) => r.text.length > 0);
    }, maxReplies);

    return rawReplies.map((r, idx) => sanitizeRecord({
        type: 'REPLY',
        id: r.id || `reply-${idx + 1}`,
        url: r.url,
        username: r.username,
        name: r.name,
        text: r.text,
        likesCount: parseNumericCount(r.likesRaw) ?? 0,
        timestamp: r.timestamp,
    }));
}

// ==================== 4. HASHTAGS & TRENDS ====================
export async function extractTrendingTopics(page) {
    return page.evaluate(() => {
        const trendCells = Array.from(document.querySelectorAll('div[data-testid="trend"], div[data-testid="cellInnerDiv"] a[href*="search?q="]'));
        return trendCells.slice(0, 30).map((cell, idx) => {
            const lines = (cell.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
            const topic = lines.find((l) => l.startsWith('#') || !l.includes('Trending')) || lines[0] || 'Topic';
            const volume = lines.find((l) => /posts|tweets/i.test(l)) || undefined;

            return {
                type: 'TREND',
                id: `trend-${idx + 1}`,
                trendRank: idx + 1,
                title: topic,
                text: volume ? `${topic} (${volume})` : topic,
                url: `https://x.com/search?q=${encodeURIComponent(topic)}`,
            };
        });
    });
}

// ==================== 5. FOLLOWERS / USER CELLS ====================
export async function extractUserCells(page, maxItems = 30) {
    return page.evaluate((max) => {
        const cells = Array.from(document.querySelectorAll('button[data-testid="UserCell"], div[data-testid="UserCell"]')).slice(0, max);
        return cells.map((cell) => {
            const lines = (cell.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
            const handleLine = lines.find((l) => l.startsWith('@'));
            const username = handleLine ? handleLine.replace(/^@/, '') : undefined;
            const name = lines[0] || username;
            const bio = lines.slice(2).filter((l) => !/^(?:follow|following|follows you)$/i.test(l)).join(' ').trim();
            return {
                type: 'USER_CELL',
                id: username,
                username,
                name,
                biography: bio || undefined,
                url: username ? `https://x.com/${username}` : undefined,
            };
        }).filter((u) => u.username);
    }, maxItems);
}

// ==================== 6. USER ID CONVERTER ====================
export async function resolveUserId(page, handle) {
    return page.evaluate((cleanHandle) => {
        const html = document.documentElement?.innerHTML || '';
        const match = html.match(/"rest_id":"(\d+)"/)
            || html.match(/"id_str":"(\d+)"/)
            || html.match(/profile_banners\/(\d+)\//);
        const numericId = match ? match[1] : undefined;

        return {
            type: 'USER_ID_CONVERTER',
            id: numericId,
            username: cleanHandle,
            url: `https://x.com/${cleanHandle}`,
        };
    }, handle);
}
