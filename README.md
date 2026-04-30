# 🔐 The Hacker News API Wrapper

Unofficial REST API wrapper for [thehackernews.com](https://thehackernews.com) — scrapes articles, full content, categories, and search. Ready to deploy as a serverless function on **Vercel**, **Netlify**, or **Cloudflare Workers**.

---

## API Documentation

Interactive Swagger UI is available at:

```
GET /api/docs
```

Raw OpenAPI 3.0 spec (JSON):

```
GET /api/docs/openapi.json
```


## 🚀 Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Run locally

```bash
npm run dev
# Server starts at http://localhost:3000
```

### 3. Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

### 4. Deploy to Netlify

```bash
npm install -g netlify-cli
netlify deploy --prod
```

---

## 📡 API Endpoints

### `GET /api`
API documentation & available endpoints.

---

### `GET /api/news`
Get the latest articles from the home page.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page_url` | string | URL for next page (from `pagination.next_url` in response) |

**Response:**
```json
{
  "success": true,
  "cached": false,
  "timestamp": "2025-04-29T10:00:00Z",
  "page_url": "https://thehackernews.com/",
  "count": 10,
  "articles": [
    {
      "slug": "2025/04/critical-zero-day-in-chrome.html",
      "url": "https://thehackernews.com/2025/04/critical-zero-day-in-chrome.html",
      "title": "Critical Zero-Day in Chrome Actively Exploited",
      "summary": "Google has issued an emergency patch...",
      "image": "https://blogger.googleusercontent.com/img/...",
      "date": "2025-04-29T08:00:00.000Z",
      "date_raw": "Apr 29, 2025",
      "tags": ["Vulnerability", "Zero Day", "Browser Security"],
      "author": "Jane Doe"
    }
  ],
  "pagination": {
    "next_url": "https://thehackernews.com/?updated-max=2025-04-28T00%3A00%3A00-07%3A00&max-results=10",
    "cursor": "2025-04-28T00:00:00-07:00"
  }
}
```

---

### `GET /api/news/:slug`
Get full article content by slug path.

**Example:**
```
GET /api/news/2025/04/critical-zero-day-in-chrome.html
```

---

### `GET /api/article?url=<url>`
Get full article content by absolute URL.

**Example:**
```
GET /api/article?url=https://thehackernews.com/2025/04/critical-zero-day-in-chrome.html
```

**Response:**
```json
{
  "success": true,
  "cached": false,
  "article": {
    "url": "https://thehackernews.com/2025/04/...",
    "slug": "2025/04/critical-zero-day-in-chrome",
    "title": "Critical Zero-Day in Chrome Actively Exploited",
    "description": "Google has issued an emergency patch...",
    "image": "https://...",
    "author": "Jane Doe",
    "published_at": "2025-04-29T08:00:00.000Z",
    "modified_at": "2025-04-29T09:30:00.000Z",
    "tags": ["Vulnerability", "Zero Day"],
    "read_time_minutes": 4,
    "content": {
      "paragraphs": [
        "Google has released an emergency security update...",
        "The vulnerability, tracked as CVE-2025-XXXX..."
      ],
      "headings": [
        { "level": "h2", "text": "What Is the Vulnerability?" },
        { "level": "h3", "text": "Affected Versions" }
      ],
      "images": [
        { "src": "https://...", "alt": "Chrome security patch" }
      ],
      "links": [
        { "text": "CVE-2025-XXXX", "url": "https://nvd.nist.gov/..." }
      ],
      "html": "<div class='articlebody'>...</div>"
    },
    "related_articles": [
      { "title": "Previous Chrome Vulnerability", "url": "https://..." }
    ]
  }
}
```

---

### `GET /api/category/:name`
Get articles from a specific category/label.

**Popular categories:**
- `Data Breaches`
- `Cyber Attack`
- `Vulnerability`
- `Malware`
- `Ransomware`
- `Phishing`
- `AI Security`
- `Cloud Security`
- `Zero Day`
- `APT`

**Example:**
```
GET /api/category/Malware
GET /api/category/Ransomware?cursor=2025-04-20T00%3A00%3A00-07%3A00
```

---

### `GET /api/search?q=<query>`
Search articles.

**Example:**
```
GET /api/search?q=ransomware+attack+2025
```

**Response:**
```json
{
  "success": true,
  "query": "ransomware attack 2025",
  "count": 8,
  "results": [ /* array of article cards */ ]
}
```

---

### `GET /api/meta`
Get site metadata and all available categories.

---

### `GET /api/cache`
View cache statistics.

### `DELETE /api/cache?secret=<secret>`
Clear the cache. Requires `CACHE_SECRET` env variable to match.

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Local dev server port |
| `CACHE_SECRET` | `thn-secret-2025` | Secret for cache clearing endpoint |

Set in Vercel:
```bash
vercel env add CACHE_SECRET
```

---

## 🏗️ Project Structure

```
thn-api/
├── api/
│   └── index.js          ← Vercel serverless handler (main router)
├── lib/
│   ├── scraper.js         ← Core scraping engine (Cheerio)
│   ├── cache.js           ← In-memory cache layer
│   └── helpers.js         ← Response utils, CORS, error handling
├── netlify/
│   └── functions/
│       └── api.js         ← Netlify Functions adapter
├── workers/
│   └── index.js           ← Cloudflare Workers adapter
├── server.js              ← Local dev server
├── vercel.json            ← Vercel routing config
├── netlify.toml           ← Netlify config
└── package.json
```

---

## 🔄 Pagination

THN uses Blogger's timestamp-based pagination. To get the next page:

```js
// First request
const res1 = await fetch('/api/news');
const data1 = await res1.json();

// Next page
if (data1.pagination?.next_url) {
  const nextPageUrl = encodeURIComponent(data1.pagination.next_url);
  const res2 = await fetch(`/api/news?page_url=${nextPageUrl}`);
}
```

---

## 💡 Usage Examples

### JavaScript / fetch
```js
// Get latest news
const news = await fetch('https://your-api.vercel.app/api/news').then(r => r.json());
console.log(news.articles);

// Get full article
const article = await fetch(
  'https://your-api.vercel.app/api/article?url=' + 
  encodeURIComponent('https://thehackernews.com/2025/04/example.html')
).then(r => r.json());
console.log(article.article.content.paragraphs);

// Search
const results = await fetch('https://your-api.vercel.app/api/search?q=phishing').then(r => r.json());

// Category feed
const malware = await fetch('https://your-api.vercel.app/api/category/Malware').then(r => r.json());
```

### Python
```python
import requests

BASE = "https://your-api.vercel.app"

# Latest news
news = requests.get(f"{BASE}/api/news").json()
for article in news["articles"]:
    print(article["title"], article["date"])

# Full article
article = requests.get(f"{BASE}/api/article", params={
    "url": "https://thehackernews.com/2025/04/example.html"
}).json()
print(article["article"]["content"]["paragraphs"])
```

### curl
```bash
# Latest news
curl https://your-api.vercel.app/api/news | jq '.articles[].title'

# Search
curl "https://your-api.vercel.app/api/search?q=zero+day" | jq '.results'

# Category
curl "https://your-api.vercel.app/api/category/Ransomware" | jq '.'
```

---

## ⚠️ Disclaimer

This is an unofficial API wrapper for educational and personal use. Respect `thehackernews.com`'s Terms of Service and robots.txt. Do not use for commercial scraping at scale. The authors are not affiliated with The Hacker News.

---

## 📄 License

MIT
