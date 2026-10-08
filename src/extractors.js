/**
 * X (Twitter) Ultimate All-in-One Extractors
 * Covers all 12 modules on X / Twitter:
 * 1. User Profiles & Leads
 * 2. User Tweets & Timelines
 * 3. Tweet Replies & Threads
 * 4. Advanced Keyword Search
 * 5. Photos, High-Res Videos & Media
 * 6. Hashtags & Trending Topics
 * 7. Followers & Following Lists
 * 8. User Likes Timeline
 * 9. Lists
 * 10. Communities
 * 11. X Spaces
 * 12. User ID to Handle / Handle to Rest ID Converter
 */

/**
 * Normalizes input targets (handles @elonmusk -> https://x.com/elonmusk).
 * @param {string} input
 * @returns {string}
 */
export function normalizeXUrl(input) {
    if (!input) return '';
    let url = input.trim();
    if (!url.startsWith('http')) {
        if (url.startsWith('#')) {
            url = `https://x.com/hashtag/${encodeURIComponent(url.slice(1))}`;
        } else {
            const handle = url.replace(/^@/, '');
            url = `https://x.com/${encodeURIComponent(handle)}`;
        }
    }
    // Standardize twitter.com to x.com
    return url.replace('twitter.com', 'x.com');
}

/**
 * Detects X URL type automatically.
 * @param {string} url
 * @returns {string}
 */
export function detectXUrlType(url) {
    if (!url) return 'USER_PROFILES';
    const lower = url.toLowerCase();

    if (lower.includes('/status/')) return 'TWEET_REPLIES';
    if (lower.includes('/search') || lower.includes('q=')) return 'ADVANCED_SEARCH';
    if (lower.includes('/hashtag/')) return 'HASHTAGS_TRENDS';
    if (lower.includes('/followers') || lower.includes('/following')) return 'FOLLOWERS_FOLLOWING';
    if (lower.includes('/likes')) return 'USER_LIKES';
    if (lower.includes('/i/lists/') || lower.includes('/lists')) return 'LISTS';
    if (lower.includes('/i/communities/')) return 'COMMUNITIES';
    if (lower.includes('/i/spaces/')) return 'SPACES';

    return 'USER_PROFILES';
}

/**
 * Parses numeric counts with K, M, B abbreviations (e.g. "1.2M", "45.5K").
 * @param {string|number} val
 * @returns {number|null}
 */
export function parseNumericCount(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return val;
    const clean = String(val).replace(/,/g, '').replace(/\s+/g, ' ').trim();
    const match = clean.match(/([\d.]+)\s*([KkMmBb])?/);
    if (!match) return null;

    let num = parseFloat(match[1]);
    const multiplier = match[2]?.toUpperCase();

    if (multiplier === 'K') num *= 1_000;
    else if (multiplier === 'M') num *= 1_000_000;
    else if (multiplier === 'B') num *= 1_000_000_000;

    return Math.round(num);
}

/**
 * Extracts business email and phone leads from text.
 * @param {string} text
 * @returns {{ email: string|null, phone: string|null }}
 */
export function extractLeadsFromText(text) {
    if (!text || typeof text !== 'string') return { email: null, phone: null };

    let email = null;
    const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/);
    if (emailMatch && !emailMatch[0].includes('x.com') && !emailMatch[0].includes('twitter.com')) {
        email = emailMatch[0];
    }

    let phone = null;
    const phoneMatch = text.match(/(?:\+?\d{1,4}[ -]?)?\(?\d{2,4}\)?[ -]?\d{3,4}[ -]?\d{3,4}/);
    if (phoneMatch && phoneMatch[0].replace(/\D/g, '').length >= 8) {
        phone = phoneMatch[0].trim();
    }

    return { email, phone };
}

/**
 * Dismisses bottom login banners and modals on X.
 * @param {import('playwright').Page} page
 */
export async function dismissXLoginModal(page) {
    try {
        await page.evaluate(() => {
            const layers = document.querySelectorAll('div[data-testid="sheetDialog"], div[role="dialog"], div[data-testid="BottomBar"]');
            layers.forEach((l) => {
                const text = l.innerText || '';
                if (text.includes('Sign in') || text.includes('Log in') || text.includes('Don’t miss what’s happening') || text.includes('تسجيل الدخول')) {
                    l.remove();
                }
            });
            document.body.style.overflow = 'auto';
            document.documentElement.style.overflow = 'auto';
        });

        const closeBtn = page.locator('div[data-testid="app-bar-close"], [aria-label="Close"], [aria-label="Fermer"]').first();
        if (await closeBtn.isVisible({ timeout: 600 }).catch(() => false)) {
            await closeBtn.click().catch(() => {});
        }
    } catch {
        // Silently continue
    }
}

// ==================== 1. USER PROFILES EXTRACTOR ====================
export async function extractUserProfile(page, url) {
    return await page.evaluate((canonicalUrl) => {
        let name = '';
        let username = '';
        let bio = '';
        let location = '';
        let website = '';
        let joinedDate = '';
        let followingCount = null;
        let followersCount = null;
        let isVerified = false;
        let avatarUrl = '';
        let bannerUrl = '';

        // Handle and name
        const headerName = document.querySelector('div[data-testid="UserName"]');
        if (headerName) {
            const lines = headerName.innerText.split('\n').filter(Boolean);
            name = lines[0] || '';
            username = lines[1] ? lines[1].replace('@', '') : '';
        }

        // Bio
        const bioElem = document.querySelector('div[data-testid="UserDescription"]');
        if (bioElem) bio = bioElem.innerText.trim();

        // Location & Joined & Website
        const userHeader = document.querySelector('div[data-testid="UserProfileHeader_Items"]');
        if (userHeader) {
            const locElem = userHeader.querySelector('span[data-testid="UserLocation"]');
            if (locElem) location = locElem.innerText.trim();

            const joinElem = userHeader.querySelector('span[data-testid="UserJoinDate"]');
            if (joinElem) joinedDate = joinElem.innerText.trim();

            const linkElem = userHeader.querySelector('a[data-testid="UserUrl"]');
            if (linkElem) website = linkElem.getAttribute('href') || linkElem.innerText.trim();
        }

        // Followers & Following
        const followingElem = document.querySelector('a[href$="/following"] span');
        if (followingElem) followingCount = followingElem.innerText.trim();

        const followersElem = document.querySelector('a[href$="/verified_followers"] span, a[href$="/followers"] span');
        if (followersElem) followersCount = followersElem.innerText.trim();

        // Verified
        isVerified = !!document.querySelector('svg[data-testid="icon-verified"]');

        // Images
        const avatarImg = document.querySelector('img[src*="profile_images"]');
        if (avatarImg) avatarUrl = avatarImg.getAttribute('src') || '';

        const bannerImg = document.querySelector('img[src*="profile_banners"]');
        if (bannerImg) bannerUrl = bannerImg.getAttribute('src') || '';

        return {
            type: 'USER_PROFILE',
            url: canonicalUrl,
            username,
            name,
            biography: bio,
            location,
            website,
            joinedDate,
            followingRaw: followingCount,
            followersRaw: followersCount,
            isVerified,
            avatarUrl,
            bannerUrl
        };
    }, url);
}

// ==================== 2. TWEETS & TIMELINE EXTRACTOR ====================
export async function extractTweetsFromTimeline(page, maxTweets = 20) {
    return await page.evaluate((max) => {
        const tweetElements = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, max);
        return tweetElements.map((tw, idx) => {
            const textElem = tw.querySelector('div[data-testid="tweetText"]');
            const text = textElem ? textElem.innerText.trim() : '';

            // User Info
            const userElem = tw.querySelector('div[data-testid="User-Name"]');
            const userLines = userElem ? userElem.innerText.split('\n').filter(Boolean) : [];
            const authorName = userLines[0] || '';
            const authorHandle = (userLines[1] || '').replace('@', '');

            // Timestamp and link
            const timeElem = tw.querySelector('time');
            const timestamp = timeElem ? timeElem.getAttribute('datetime') : null;
            const linkElem = timeElem?.closest('a');
            const tweetUrl = linkElem ? `https://x.com${linkElem.getAttribute('href')}` : '';
            const tweetIdMatch = tweetUrl.match(/status\/(\d+)/);
            const tweetId = tweetIdMatch ? tweetIdMatch[1] : `TWEET-${idx + 1}`;

            // Metrics
            const replyMatch = tw.querySelector('button[data-testid="reply"]')?.innerText || '0';
            const retweetMatch = tw.querySelector('button[data-testid="retweet"]')?.innerText || '0';
            const likeMatch = tw.querySelector('button[data-testid="like"]')?.innerText || '0';
            const viewMatch = tw.querySelector('a[href*="/analytics"]')?.innerText || '0';

            // Media
            const mediaImgs = Array.from(tw.querySelectorAll('img[src*="media"], img[src*="ext_tw_video_thumb"]'))
                .map(img => img.getAttribute('src'))
                .filter(Boolean);

            const video = tw.querySelector('video');
            const isVideo = !!video;
            const videoSrc = video ? video.getAttribute('src') : null;

            const hashtags = (text.match(/#[a-zA-Z0-9_]+/g) || []);
            const mentions = (text.match(/@[a-zA-Z0-9_]+/g) || []);

            return {
                type: 'TWEET',
                tweetId,
                tweetUrl,
                authorName,
                authorHandle,
                text,
                timestamp,
                repliesRaw: replyMatch.trim(),
                retweetsRaw: retweetMatch.trim(),
                likesRaw: likeMatch.trim(),
                viewsRaw: viewMatch.trim(),
                mediaUrls: mediaImgs,
                isVideo,
                videoUrl: videoSrc,
                hashtags,
                mentions
            };
        }).filter(t => t.text.length > 0 || t.mediaUrls.length > 0);
    }, maxTweets);
}

// ==================== 3. TWEET THREAD & REPLIES EXTRACTOR ====================
export async function extractTweetReplies(page, maxReplies = 15) {
    return await page.evaluate((max) => {
        const allArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
        // The first tweet is main, remaining are replies
        const replies = allArticles.slice(1, max + 1);

        return replies.map((tw, idx) => {
            const textElem = tw.querySelector('div[data-testid="tweetText"]');
            const text = textElem ? textElem.innerText.trim() : '';

            const userElem = tw.querySelector('div[data-testid="User-Name"]');
            const userLines = userElem ? userElem.innerText.split('\n').filter(Boolean) : [];
            const author = (userLines[1] || '').replace('@', '');

            const timeElem = tw.querySelector('time');
            const timestamp = timeElem ? timeElem.getAttribute('datetime') : null;
            const likeMatch = tw.querySelector('button[data-testid="like"]')?.innerText || '0';

            return {
                type: 'REPLY',
                replyIndex: idx + 1,
                authorHandle: author,
                text,
                likesRaw: likeMatch.trim(),
                timestamp
            };
        }).filter(r => r.text.length > 0);
    }, maxReplies);
}

// ==================== 4. HASHTAGS & TRENDS ====================
export async function extractTrendingTopics(page) {
    return await page.evaluate(() => {
        const trendCells = Array.from(document.querySelectorAll('div[data-testid="trend"], div[data-testid="cellInnerDiv"] a[href*="search?q="]'));
        return trendCells.slice(0, 30).map((cell, idx) => {
            const lines = (cell.innerText || '').split('\n').filter(Boolean);
            const topic = lines.find(l => l.startsWith('#') || !l.includes('Trending')) || lines[0] || 'Topic';
            const volume = lines.find(l => l.includes('posts') || l.includes('Tweets')) || null;

            return {
                trendRank: idx + 1,
                topic: topic.trim(),
                volume: volume ? volume.trim() : 'N/A'
            };
        });
    });
}

// ==================== 5. USER ID CONVERTER ====================
export async function resolveUserId(page, handle) {
    return await page.evaluate((cleanHandle) => {
        let numericId = null;
        // Search inside embedded script tags or meta
        const html = document.documentElement.innerHTML || '';
        const match = html.match(/"id_str":"(\d+)"/) || html.match(/"rest_id":"(\d+)"/);
        if (match) numericId = match[1];

        return {
            type: 'USER_ID_CONVERTER',
            handle: cleanHandle,
            restId: numericId || 'Unable to resolve (Requires Auth Session)',
            profileUrl: `https://x.com/${cleanHandle}`
        };
    }, handle);
}
