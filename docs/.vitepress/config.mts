import { defineConfig } from 'vitepress';
import llmstxt from 'vitepress-plugin-llms';

export default defineConfig({
  // LLM-friendly documentation generation
  vite: {
    plugins: [llmstxt()],
  },

  title: 'OneBun Framework',
  description: 'A bun.js framework inspired by nest.js with effect.ts',

  // Base path for GitHub Pages (repo name)
  base: '/onebun/',

  // Clean URLs without .html extension
  cleanUrls: true,

  // Last updated timestamp
  lastUpdated: true,

  // Markdown configuration
  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
    lineNumbers: true,
  },

  // Theme configuration
  themeConfig: {
    logo: '/logo.png',

    // Navigation bar
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Features', link: '/features' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'API', link: '/api/core' },
      { text: 'Examples', link: '/examples/basic-app' },
      { text: 'AI Docs', link: '/ai-docs' },
    ],

    // Sidebar navigation
    sidebar: {
      '/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Home', link: '/' },
            { text: 'Features Overview', link: '/features' },
            { text: 'Getting Started', link: '/getting-started' },
            { text: 'Architecture', link: '/architecture' },
          ],
        },
        {
          text: 'Core Framework',
          collapsed: false,
          items: [
            { text: 'Core', link: '/api/core' },
            { text: 'Decorators', link: '/api/decorators' },
            { text: 'Controllers', link: '/api/controllers' },
            { text: 'Services', link: '/api/services' },
            { text: 'Validation', link: '/api/validation' },
          ],
        },
        {
          text: 'Communication',
          collapsed: false,
          items: [
            { text: 'WebSocket Gateway', link: '/api/websocket' },
            { text: 'HTTP Client', link: '/api/requests' },
          ],
        },
        {
          text: 'Data & State',
          collapsed: false,
          items: [
            { text: 'Database (Drizzle)', link: '/api/drizzle' },
            { text: 'Cache', link: '/api/cache' },
            { text: 'Queue & Scheduler', link: '/api/queue' },
          ],
        },
        {
          text: 'Observability',
          collapsed: false,
          items: [
            { text: 'Logger', link: '/api/logger' },
            { text: 'Metrics', link: '/api/metrics' },
            { text: 'Tracing', link: '/api/trace' },
          ],
        },
        {
          text: 'Configuration',
          collapsed: false,
          items: [{ text: 'Environment', link: '/api/envs' }],
        },
        {
          text: 'Examples',
          collapsed: false,
          items: [
            { text: 'Basic Application', link: '/examples/basic-app' },
            { text: 'CRUD API', link: '/examples/crud-api' },
            { text: 'Multi-Service', link: '/examples/multi-service' },
            { text: 'WebSocket Chat', link: '/examples/websocket-chat' },
          ],
        },
        {
          text: 'AI Documentation',
          collapsed: false,
          items: [{ text: 'AI Documentation', link: '/ai-docs' }],
        },
      ],
    },

    // Social links
    socialLinks: [
      { icon: 'github', link: 'https://github.com/RemRyahirev/onebun' },
    ],

    // Footer
    footer: {
      message: 'Released under the LGPL-3.0 License.',
      copyright: 'Copyright © 2024-present RemRyahirev',
    },

    // Search
    search: {
      provider: 'local',
    },

    // Edit link
    editLink: {
      pattern: 'https://github.com/RemRyahirev/onebun/edit/master/docs/:path',
      text: 'Edit this page on GitHub',
    },

    // Outline depth
    outline: {
      level: [2, 3],
    },
  },

  // Head tags
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/onebun/logo.png' }],
    ['meta', { name: 'theme-color', content: '#646cff' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'OneBun Framework' }],
    ['meta', { property: 'og:description', content: 'A bun.js framework inspired by nest.js with effect.ts' }],
  ],
});
