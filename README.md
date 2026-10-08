# X / Twitter Ultimate All-in-One Scraper (Enterprise Edition)

The most comprehensive, reliable, and stealthy **X (Twitter) Intelligence & Data Scraper** on Apify.  
Built with **JavaScript (Node.js), Crawlee, and Playwright**, featuring automatic URL routing, login modal dismissal, and 12 specialized extraction modules.

---

## 🌟 12 Scraping Modules Supported

1. **User Profiles & B2B Leads**: Official display name, @handle, verified checkmark status, followers count, following count, total tweets, bio, location, join date, and **direct contact email and phone number extraction**.
2. **User Tweets & Timelines**: Full tweet text (including long-form articles), publication timestamps, direct tweet permalinks, views/impressions, likes, retweets, replies, and quotes.
3. **Tweet Replies & Thread Reconstruction**: Scrapes complete conversation threads and user replies.
4. **Advanced Keyword Search**: Queries X search with live filters, date windows, and engagement thresholds (`min_faves:500`).
5. **High-Res Photos, Videos & Media**: Direct MP4 video download URLs, thumbnails, and original photo URLs.
6. **Hashtags & Trending Topics**: Worldwide and local trending topics with tweet volumes.
7. **Followers & Following Networks**: User social graph connections.
8. **User Likes Timeline**: Tweets favorited by target accounts.
9. **X Lists**: Curated lists and member feeds.
10. **X Communities**: Community topics and discussions.
11. **X Spaces**: Audio live stream metadata, hosts, and listener stats.
12. **Screen Name ⇄ Rest ID Converter**: Converts `@handles` to immutable numeric Twitter IDs and vice versa.

---

## 📥 Input Configuration

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `scrapeMode` | Select | `"AUTO_DETECT"` | Choose from `AUTO_DETECT`, `USER_PROFILES`, `USER_TWEETS`, `TWEET_REPLIES`, `ADVANCED_SEARCH`, `HASHTAGS_TRENDS`, `FOLLOWERS_FOLLOWING`, `USER_LIKES`, `LISTS`, `COMMUNITIES`, `SPACES`, `USER_ID_CONVERTER`. |
| `targetUrls` | Array | Required | Target profile URLs, tweet links, or handles (e.g. `https://x.com/elonmusk`, `@OpenAI`). |
| `searchQueries` | Array | `[]` | Search phrases or queries for X Search mode. |
| `maxTweets` | Integer | `20` | Maximum tweets/items to extract. |
| `maxRepliesPerTweet` | Integer | `10` | Max replies to extract in conversation threads. |
| `extractEmailAndPhone` | Boolean | `true` | Extract business emails and phone numbers from bios. |
| `proxyConfiguration` | Object | `RESIDENTIAL` | Apify Residential Proxy settings. |
| `customCookies` | String | `""` | Optional session cookies (`auth_token`, `ct0`) for authenticated mode. |

---

## 📤 Sample Output (Profile with Leads)

```json
{
  "type": "USER_PROFILE",
  "url": "https://x.com/elonmusk",
  "username": "elonmusk",
  "name": "Elon Musk",
  "biography": "",
  "location": "",
  "followersCount": 210000000,
  "followingCount": 850,
  "isVerified": true,
  "recentTweets": [
    {
      "type": "TWEET",
      "tweetId": "1840000000000000000",
      "tweetUrl": "https://x.com/elonmusk/status/1840000000000000000",
      "text": "Occupying Mars",
      "likesRaw": "250K",
      "retweetsRaw": "35K",
      "viewsRaw": "15M"
    }
  ],
  "scrapedAt": "2026-10-08T10:00:00.000Z"
}
```

---

## 🛡️ Anti-Block & Compliance
- Automatic login modal & bottom sheet dismissal.
- User-Agent emulation and security client headers.
- Uses Residential Proxy rotation by default.

---

## 📄 License
Apache-2.0
