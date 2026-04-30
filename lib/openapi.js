/**
 * OpenAPI 3.0 Specification for THN API
 */

const spec = {
  openapi: "3.0.3",
  info: {
    title: "The Hacker News API",
    description:
      "Unofficial REST API wrapper for thehackernews.com. Scrapes and serves cybersecurity news articles, categories, and search in a structured JSON format.",
    version: "1.0.0",
    contact: {
      name: "THN API",
      url: "https://thehackernews.com",
    },
    license: {
      name: "MIT",
    },
  },
  servers: [
    {
      url: "/",
      description: "Current server",
    },
  ],
  tags: [
    { name: "News", description: "Latest articles and full article content" },
    { name: "Category", description: "Browse articles by category/label" },
    { name: "Search", description: "Search articles by keyword" },
    { name: "Meta", description: "Site metadata and category list" },
    { name: "Cache", description: "Cache management" },
  ],
  paths: {
    "/api": {
      get: {
        tags: ["Meta"],
        summary: "API info and documentation",
        operationId: "getApiInfo",
        responses: {
          200: {
            description: "API info",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiInfo" },
              },
            },
          },
        },
      },
    },
    "/api/news": {
      get: {
        tags: ["News"],
        summary: "Get latest articles",
        description:
          "Scrapes the THN homepage for the latest cybersecurity articles. Use `page_url` from the previous response's `next_page_url` to paginate.",
        operationId: "getLatestNews",
        parameters: [
          {
            name: "page_url",
            in: "query",
            description:
              "Full URL of the next page (from `next_page_url` in a previous response)",
            required: false,
            schema: { type: "string", example: "https://thehackernews.com/search?updated-max=2026-04-28T00%3A00%3A00%2B05%3A30&max-results=10" },
          },
        ],
        responses: {
          200: {
            description: "List of articles with pagination info",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArticleListResponse" },
                example: {
                  success: true,
                  cached: false,
                  page_url: "https://thehackernews.com",
                  count: 12,
                  next_page_url: "https://thehackernews.com/?updated-max=...",
                  next_cursor: "2026-04-28T00:00:00+05:30",
                  articles: [
                    {
                      slug: "2026/04/example-article.html",
                      url: "https://thehackernews.com/2026/04/example-article.html",
                      title: "Example Cybersecurity Article",
                      summary: "Article summary...",
                      image: "https://blogger.googleusercontent.com/...",
                      date: "2026-04-29T00:00:00.000Z",
                      date_raw: "Apr 29, 2026",
                      tags: ["Malware", "Ransomware"],
                      author: null,
                    },
                  ],
                  pagination: {
                    next_url: "https://thehackernews.com/?updated-max=...",
                    cursor: "2026-04-28T00:00:00+05:30",
                  },
                },
              },
            },
          },
          502: { $ref: "#/components/responses/UpstreamError" },
          504: { $ref: "#/components/responses/TimeoutError" },
        },
      },
    },
    "/api/news/{slug}": {
      get: {
        tags: ["News"],
        summary: "Get full article by slug",
        description:
          "Fetch the full content of a single article. The slug is the path after `thehackernews.com/`, e.g. `2026/04/article-name.html`",
        operationId: "getArticleBySlug",
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            description: "Article path, e.g. `2026/04/article-name.html`",
            schema: {
              type: "string",
              example: "2026/04/sap-npm-packages-compromised-by-mini.html",
            },
          },
        ],
        responses: {
          200: {
            description: "Full article data",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArticleResponse" },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
          502: { $ref: "#/components/responses/UpstreamError" },
        },
      },
    },
    "/api/article": {
      get: {
        tags: ["News"],
        summary: "Get full article by absolute URL",
        operationId: "getArticleByUrl",
        parameters: [
          {
            name: "url",
            in: "query",
            required: true,
            description: "Full URL of the article",
            schema: {
              type: "string",
              example:
                "https://thehackernews.com/2026/04/sap-npm-packages-compromised-by-mini.html",
            },
          },
        ],
        responses: {
          200: {
            description: "Full article data",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArticleResponse" },
              },
            },
          },
          400: { $ref: "#/components/responses/BadRequest" },
          502: { $ref: "#/components/responses/UpstreamError" },
        },
      },
    },
    "/api/category/{name}": {
      get: {
        tags: ["Category"],
        summary: "Get articles by category",
        description:
          "Fetch articles from a THN category (Blogger label). Use `cursor` from the response to load the next page.",
        operationId: "getCategoryArticles",
        parameters: [
          {
            name: "name",
            in: "path",
            required: true,
            description: "Category/label name",
            schema: {
              type: "string",
              example: "Malware",
              enum: [
                "Data Breaches",
                "Cyber Attack",
                "Vulnerability",
                "Malware",
                "Ransomware",
                "Phishing",
                "Security",
                "Privacy",
                "Zero Day",
                "APT",
                "AI Security",
                "Cloud Security",
                "Mobile Security",
                "IoT Security",
                "Cryptography",
              ],
            },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            description:
              "Pagination cursor (the `next_cursor` value from a previous response)",
            schema: { type: "string", example: "2026-04-28T00:00:00+05:30" },
          },
        ],
        responses: {
          200: {
            description: "Articles in this category",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArticleListResponse" },
              },
            },
          },
          502: { $ref: "#/components/responses/UpstreamError" },
        },
      },
    },
    "/api/search": {
      get: {
        tags: ["Search"],
        summary: "Search articles",
        description: "Search THN articles using Blogger's built-in search.",
        operationId: "searchArticles",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            description: "Search query",
            schema: { type: "string", example: "ransomware" },
          },
        ],
        responses: {
          200: {
            description: "Search results",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SearchResponse" },
              },
            },
          },
          400: { $ref: "#/components/responses/BadRequest" },
          502: { $ref: "#/components/responses/UpstreamError" },
        },
      },
    },
    "/api/meta": {
      get: {
        tags: ["Meta"],
        summary: "Get site metadata and category list",
        operationId: "getSiteMeta",
        responses: {
          200: {
            description: "Site metadata",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MetaResponse" },
              },
            },
          },
        },
      },
    },
    "/api/cache": {
      get: {
        tags: ["Cache"],
        summary: "Get cache statistics",
        operationId: "getCacheStats",
        responses: {
          200: {
            description: "Cache stats",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CacheStatsResponse" },
              },
            },
          },
        },
      },
      delete: {
        tags: ["Cache"],
        summary: "Clear cache",
        operationId: "clearCache",
        parameters: [
          {
            name: "secret",
            in: "query",
            required: true,
            description: "Admin secret (env: CACHE_SECRET, default: thn-secret-2025)",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Cache cleared",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessMessage" },
              },
            },
          },
          401: { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
  },
  components: {
    schemas: {
      ArticleCard: {
        type: "object",
        description: "Article summary as shown on list pages",
        properties: {
          slug: {
            type: "string",
            description: "Full path slug, e.g. 2026/04/article-name.html",
            example: "2026/04/sap-npm-packages-compromised-by-mini.html",
          },
          url: {
            type: "string",
            format: "uri",
            example: "https://thehackernews.com/2026/04/sap-npm-packages-compromised-by-mini.html",
          },
          title: { type: "string", example: "SAP-Related npm Packages Compromised" },
          summary: { type: "string", description: "Article excerpt/summary" },
          image: { type: "string", format: "uri", nullable: true },
          date: {
            type: "string",
            format: "date-time",
            nullable: true,
            description: "ISO 8601 date (null if unparseable)",
          },
          date_raw: {
            type: "string",
            example: "Apr 29, 2026",
            description: "Human-readable date as shown on the site",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            example: ["Malware", "Supply Chain"],
          },
          author: { type: "string", nullable: true },
        },
      },
      ArticleFull: {
        type: "object",
        description: "Full article with content",
        allOf: [
          {
            properties: {
              slug: { type: "string" },
              url: { type: "string", format: "uri" },
              title: { type: "string" },
              description: { type: "string" },
              image: { type: "string", format: "uri", nullable: true },
              author: { type: "string", nullable: true },
              published_at: { type: "string", format: "date-time", nullable: true },
              modified_at: { type: "string", format: "date-time", nullable: true },
              tags: { type: "array", items: { type: "string" } },
              read_time_minutes: { type: "integer", example: 4 },
              content: {
                type: "object",
                properties: {
                  paragraphs: { type: "array", items: { type: "string" } },
                  headings: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        level: { type: "string", enum: ["h2", "h3", "h4"] },
                        text: { type: "string" },
                      },
                    },
                  },
                  images: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        src: { type: "string", format: "uri" },
                        alt: { type: "string" },
                      },
                    },
                  },
                  links: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        text: { type: "string" },
                        url: { type: "string", format: "uri" },
                      },
                    },
                  },
                  html: { type: "string", description: "Raw HTML of the article body" },
                },
              },
              related_articles: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    url: { type: "string", format: "uri" },
                  },
                },
              },
            },
          },
        ],
      },
      Pagination: {
        type: "object",
        nullable: true,
        properties: {
          next_url: { type: "string", format: "uri", nullable: true },
          cursor: { type: "string", nullable: true },
        },
      },
      ArticleListResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          timestamp: { type: "string", format: "date-time" },
          cached: { type: "boolean" },
          page_url: { type: "string", format: "uri" },
          count: { type: "integer", example: 12 },
          articles: {
            type: "array",
            items: { $ref: "#/components/schemas/ArticleCard" },
          },
          next_page_url: {
            type: "string",
            format: "uri",
            nullable: true,
            description: "Pass this as page_url to get the next page",
          },
          next_cursor: { type: "string", nullable: true },
          pagination: { $ref: "#/components/schemas/Pagination" },
        },
      },
      ArticleResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          timestamp: { type: "string", format: "date-time" },
          cached: { type: "boolean" },
          article: { $ref: "#/components/schemas/ArticleFull" },
        },
      },
      SearchResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          timestamp: { type: "string", format: "date-time" },
          cached: { type: "boolean" },
          query: { type: "string", example: "ransomware" },
          count: { type: "integer", example: 8 },
          articles: {
            type: "array",
            items: { $ref: "#/components/schemas/ArticleCard" },
          },
        },
      },
      MetaResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          site: { type: "string", example: "The Hacker News" },
          base_url: { type: "string", format: "uri" },
          categories: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", example: "Malware" },
                slug: { type: "string", example: "malware" },
                url: { type: "string", format: "uri" },
              },
            },
          },
        },
      },
      CacheStatsResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          cache: {
            type: "object",
            properties: {
              size: { type: "integer" },
              keys: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
      SuccessMessage: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          message: { type: "string" },
        },
      },
      ApiInfo: {
        type: "object",
        properties: {
          name: { type: "string" },
          version: { type: "string" },
          description: { type: "string" },
          endpoints: { type: "object" },
        },
      },
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
        },
      },
    },
    responses: {
      BadRequest: {
        description: "Missing or invalid query parameter",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { success: false, error: "Missing required query param: q" },
          },
        },
      },
      NotFound: {
        description: "Route or resource not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      Unauthorized: {
        description: "Invalid or missing secret",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      UpstreamError: {
        description: "Upstream request to thehackernews.com failed",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      TimeoutError: {
        description: "Upstream request timed out",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
    },
  },
};

module.exports = spec;
