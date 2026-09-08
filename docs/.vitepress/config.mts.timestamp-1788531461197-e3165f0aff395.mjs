// docs/.vitepress/config.mts
import { defineConfig } from "file:///projects/onebun/withEffect/node_modules/.bun/vitepress@1.6.4+ab0cadcd18669e29/node_modules/vitepress/dist/node/index.js";
import llmstxt from "file:///projects/onebun/withEffect/node_modules/.bun/vitepress-plugin-llms@1.12.1/node_modules/vitepress-plugin-llms/dist/index.js";
var config_default = defineConfig({
  // LLM-friendly documentation generation
  vite: {
    plugins: [llmstxt()]
  },
  title: "OneBun Framework",
  description: "A bun.js framework inspired by nest.js with effect.ts",
  // Base path for GitHub Pages (custom domain onebun.dev serves from root)
  base: "/",
  // Clean URLs without .html extension
  cleanUrls: true,
  // Last updated timestamp
  lastUpdated: true,
  // Markdown configuration
  markdown: {
    theme: {
      light: "github-light",
      dark: "github-dark"
    },
    lineNumbers: true
  },
  // Theme configuration
  themeConfig: {
    logo: "/logo.png",
    // Navigation bar
    nav: [
      { text: "Home", link: "/" },
      { text: "Features", link: "/features" },
      { text: "Getting Started", link: "/getting-started" },
      { text: "API", link: "/api/core" },
      { text: "Examples", link: "/examples/basic-app" },
      { text: "AI Docs", link: "/ai-docs" },
      { text: "Roadmap", link: "/roadmap" }
    ],
    // Sidebar navigation
    sidebar: {
      "/": [
        {
          text: "Introduction",
          items: [
            { text: "Home", link: "/" },
            { text: "Features Overview", link: "/features" },
            { text: "Getting Started", link: "/getting-started" },
            { text: "Architecture", link: "/architecture" },
            { text: "Migration from NestJS", link: "/migration-nestjs" }
          ]
        },
        {
          text: "Core Framework",
          collapsed: false,
          items: [
            { text: "Core", link: "/api/core" },
            { text: "Decorators", link: "/api/decorators" },
            { text: "Controllers", link: "/api/controllers" },
            { text: "Services", link: "/api/services" },
            { text: "Validation", link: "/api/validation" },
            { text: "Guards", link: "/api/guards" },
            { text: "Interceptors", link: "/api/interceptors" },
            { text: "Exception Filters", link: "/api/exception-filters" },
            { text: "Security Middleware", link: "/api/security" }
          ]
        },
        {
          text: "Communication",
          collapsed: false,
          items: [
            { text: "WebSocket Gateway", link: "/api/websocket" },
            { text: "HTTP Client", link: "/api/requests" },
            { text: "API Documentation (OpenAPI)", link: "/api/docs" }
          ]
        },
        {
          text: "Data & State",
          collapsed: false,
          items: [
            { text: "Database (Drizzle)", link: "/api/drizzle" },
            { text: "Cache", link: "/api/cache" },
            { text: "Queue & Scheduler", link: "/api/queue" }
          ]
        },
        {
          text: "Observability",
          collapsed: false,
          items: [
            { text: "Logger", link: "/api/logger" },
            { text: "Metrics", link: "/api/metrics" },
            { text: "Tracing", link: "/api/trace" }
          ]
        },
        {
          text: "Configuration",
          collapsed: false,
          items: [{ text: "Environment", link: "/api/envs" }]
        },
        {
          text: "Testing",
          collapsed: false,
          items: [{ text: "Testing Utilities", link: "/testing" }]
        },
        {
          text: "Examples",
          collapsed: false,
          items: [
            { text: "Basic Application", link: "/examples/basic-app" },
            { text: "CRUD API", link: "/examples/crud-api" },
            { text: "Multi-Service", link: "/examples/multi-service" },
            { text: "WebSocket Chat", link: "/examples/websocket-chat" }
          ]
        },
        {
          text: "AI Documentation",
          collapsed: false,
          items: [{ text: "AI Documentation", link: "/ai-docs" }]
        },
        {
          text: "Performance",
          collapsed: false,
          items: [{ text: "Benchmarks", link: "/benchmarks" }]
        },
        {
          text: "Project",
          collapsed: false,
          items: [{ text: "Roadmap", link: "/roadmap" }]
        }
      ]
    },
    // Social links
    socialLinks: [
      { icon: "github", link: "https://github.com/RemRyahirev/onebun" }
    ],
    // Footer
    footer: {
      message: "Released under the MPL-2.0 License.",
      copyright: "Copyright \xA9 2024-present RemRyahirev"
    },
    // Search
    search: {
      provider: "local"
    },
    // Edit link
    editLink: {
      pattern: "https://github.com/RemRyahirev/onebun/edit/master/docs/:path",
      text: "Edit this page on GitHub"
    },
    // Outline depth
    outline: {
      level: [2, 3]
    }
  },
  // Head tags
  head: [
    ["link", { rel: "icon", type: "image/png", href: "/logo.png" }],
    ["meta", { name: "theme-color", content: "#646cff" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "OneBun Framework" }],
    ["meta", { property: "og:description", content: "A bun.js framework inspired by nest.js with effect.ts" }],
    // Plausible analytics
    ["script", { async: "", src: "https://plausible.io/js/pa-MzObSIBpey3LVouMVQma4.js" }],
    ["script", {}, "window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()"]
  ]
});
export {
  config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiZG9jcy8udml0ZXByZXNzL2NvbmZpZy5tdHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvcHJvamVjdHMvb25lYnVuL3dpdGhFZmZlY3QvZG9jcy8udml0ZXByZXNzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvcHJvamVjdHMvb25lYnVuL3dpdGhFZmZlY3QvZG9jcy8udml0ZXByZXNzL2NvbmZpZy5tdHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Byb2plY3RzL29uZWJ1bi93aXRoRWZmZWN0L2RvY3MvLnZpdGVwcmVzcy9jb25maWcubXRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZXByZXNzJztcbmltcG9ydCBsbG1zdHh0IGZyb20gJ3ZpdGVwcmVzcy1wbHVnaW4tbGxtcyc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIC8vIExMTS1mcmllbmRseSBkb2N1bWVudGF0aW9uIGdlbmVyYXRpb25cbiAgdml0ZToge1xuICAgIHBsdWdpbnM6IFtsbG1zdHh0KCldLFxuICB9LFxuXG4gIHRpdGxlOiAnT25lQnVuIEZyYW1ld29yaycsXG4gIGRlc2NyaXB0aW9uOiAnQSBidW4uanMgZnJhbWV3b3JrIGluc3BpcmVkIGJ5IG5lc3QuanMgd2l0aCBlZmZlY3QudHMnLFxuXG4gIC8vIEJhc2UgcGF0aCBmb3IgR2l0SHViIFBhZ2VzIChjdXN0b20gZG9tYWluIG9uZWJ1bi5kZXYgc2VydmVzIGZyb20gcm9vdClcbiAgYmFzZTogJy8nLFxuXG4gIC8vIENsZWFuIFVSTHMgd2l0aG91dCAuaHRtbCBleHRlbnNpb25cbiAgY2xlYW5VcmxzOiB0cnVlLFxuXG4gIC8vIExhc3QgdXBkYXRlZCB0aW1lc3RhbXBcbiAgbGFzdFVwZGF0ZWQ6IHRydWUsXG5cbiAgLy8gTWFya2Rvd24gY29uZmlndXJhdGlvblxuICBtYXJrZG93bjoge1xuICAgIHRoZW1lOiB7XG4gICAgICBsaWdodDogJ2dpdGh1Yi1saWdodCcsXG4gICAgICBkYXJrOiAnZ2l0aHViLWRhcmsnLFxuICAgIH0sXG4gICAgbGluZU51bWJlcnM6IHRydWUsXG4gIH0sXG5cbiAgLy8gVGhlbWUgY29uZmlndXJhdGlvblxuICB0aGVtZUNvbmZpZzoge1xuICAgIGxvZ286ICcvbG9nby5wbmcnLFxuXG4gICAgLy8gTmF2aWdhdGlvbiBiYXJcbiAgICBuYXY6IFtcbiAgICAgIHsgdGV4dDogJ0hvbWUnLCBsaW5rOiAnLycgfSxcbiAgICAgIHsgdGV4dDogJ0ZlYXR1cmVzJywgbGluazogJy9mZWF0dXJlcycgfSxcbiAgICAgIHsgdGV4dDogJ0dldHRpbmcgU3RhcnRlZCcsIGxpbms6ICcvZ2V0dGluZy1zdGFydGVkJyB9LFxuICAgICAgeyB0ZXh0OiAnQVBJJywgbGluazogJy9hcGkvY29yZScgfSxcbiAgICAgIHsgdGV4dDogJ0V4YW1wbGVzJywgbGluazogJy9leGFtcGxlcy9iYXNpYy1hcHAnIH0sXG4gICAgICB7IHRleHQ6ICdBSSBEb2NzJywgbGluazogJy9haS1kb2NzJyB9LFxuICAgICAgeyB0ZXh0OiAnUm9hZG1hcCcsIGxpbms6ICcvcm9hZG1hcCcgfSxcbiAgICBdLFxuXG4gICAgLy8gU2lkZWJhciBuYXZpZ2F0aW9uXG4gICAgc2lkZWJhcjoge1xuICAgICAgJy8nOiBbXG4gICAgICAgIHtcbiAgICAgICAgICB0ZXh0OiAnSW50cm9kdWN0aW9uJyxcbiAgICAgICAgICBpdGVtczogW1xuICAgICAgICAgICAgeyB0ZXh0OiAnSG9tZScsIGxpbms6ICcvJyB9LFxuICAgICAgICAgICAgeyB0ZXh0OiAnRmVhdHVyZXMgT3ZlcnZpZXcnLCBsaW5rOiAnL2ZlYXR1cmVzJyB9LFxuICAgICAgICAgICAgeyB0ZXh0OiAnR2V0dGluZyBTdGFydGVkJywgbGluazogJy9nZXR0aW5nLXN0YXJ0ZWQnIH0sXG4gICAgICAgICAgICB7IHRleHQ6ICdBcmNoaXRlY3R1cmUnLCBsaW5rOiAnL2FyY2hpdGVjdHVyZScgfSxcbiAgICAgICAgICAgIHsgdGV4dDogJ01pZ3JhdGlvbiBmcm9tIE5lc3RKUycsIGxpbms6ICcvbWlncmF0aW9uLW5lc3RqcycgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdGV4dDogJ0NvcmUgRnJhbWV3b3JrJyxcbiAgICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICAgIGl0ZW1zOiBbXG4gICAgICAgICAgICB7IHRleHQ6ICdDb3JlJywgbGluazogJy9hcGkvY29yZScgfSxcbiAgICAgICAgICAgIHsgdGV4dDogJ0RlY29yYXRvcnMnLCBsaW5rOiAnL2FwaS9kZWNvcmF0b3JzJyB9LFxuICAgICAgICAgICAgeyB0ZXh0OiAnQ29udHJvbGxlcnMnLCBsaW5rOiAnL2FwaS9jb250cm9sbGVycycgfSxcbiAgICAgICAgICAgIHsgdGV4dDogJ1NlcnZpY2VzJywgbGluazogJy9hcGkvc2VydmljZXMnIH0sXG4gICAgICAgICAgICB7IHRleHQ6ICdWYWxpZGF0aW9uJywgbGluazogJy9hcGkvdmFsaWRhdGlvbicgfSxcbiAgICAgICAgICAgIHsgdGV4dDogJ0d1YXJkcycsIGxpbms6ICcvYXBpL2d1YXJkcycgfSxcbiAgICAgICAgICAgIHsgdGV4dDogJ0ludGVyY2VwdG9ycycsIGxpbms6ICcvYXBpL2ludGVyY2VwdG9ycycgfSxcbiAgICAgICAgICAgIHsgdGV4dDogJ0V4Y2VwdGlvbiBGaWx0ZXJzJywgbGluazogJy9hcGkvZXhjZXB0aW9uLWZpbHRlcnMnIH0sXG4gICAgICAgICAgICB7IHRleHQ6ICdTZWN1cml0eSBNaWRkbGV3YXJlJywgbGluazogJy9hcGkvc2VjdXJpdHknIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHRleHQ6ICdDb21tdW5pY2F0aW9uJyxcbiAgICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICAgIGl0ZW1zOiBbXG4gICAgICAgICAgICB7IHRleHQ6ICdXZWJTb2NrZXQgR2F0ZXdheScsIGxpbms6ICcvYXBpL3dlYnNvY2tldCcgfSxcbiAgICAgICAgICAgIHsgdGV4dDogJ0hUVFAgQ2xpZW50JywgbGluazogJy9hcGkvcmVxdWVzdHMnIH0sXG4gICAgICAgICAgICB7IHRleHQ6ICdBUEkgRG9jdW1lbnRhdGlvbiAoT3BlbkFQSSknLCBsaW5rOiAnL2FwaS9kb2NzJyB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0ZXh0OiAnRGF0YSAmIFN0YXRlJyxcbiAgICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICAgIGl0ZW1zOiBbXG4gICAgICAgICAgICB7IHRleHQ6ICdEYXRhYmFzZSAoRHJpenpsZSknLCBsaW5rOiAnL2FwaS9kcml6emxlJyB9LFxuICAgICAgICAgICAgeyB0ZXh0OiAnQ2FjaGUnLCBsaW5rOiAnL2FwaS9jYWNoZScgfSxcbiAgICAgICAgICAgIHsgdGV4dDogJ1F1ZXVlICYgU2NoZWR1bGVyJywgbGluazogJy9hcGkvcXVldWUnIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHRleHQ6ICdPYnNlcnZhYmlsaXR5JyxcbiAgICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICAgIGl0ZW1zOiBbXG4gICAgICAgICAgICB7IHRleHQ6ICdMb2dnZXInLCBsaW5rOiAnL2FwaS9sb2dnZXInIH0sXG4gICAgICAgICAgICB7IHRleHQ6ICdNZXRyaWNzJywgbGluazogJy9hcGkvbWV0cmljcycgfSxcbiAgICAgICAgICAgIHsgdGV4dDogJ1RyYWNpbmcnLCBsaW5rOiAnL2FwaS90cmFjZScgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdGV4dDogJ0NvbmZpZ3VyYXRpb24nLFxuICAgICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgICAgaXRlbXM6IFt7IHRleHQ6ICdFbnZpcm9ubWVudCcsIGxpbms6ICcvYXBpL2VudnMnIH1dLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdGV4dDogJ1Rlc3RpbmcnLFxuICAgICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgICAgaXRlbXM6IFt7IHRleHQ6ICdUZXN0aW5nIFV0aWxpdGllcycsIGxpbms6ICcvdGVzdGluZycgfV0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0ZXh0OiAnRXhhbXBsZXMnLFxuICAgICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgICAgaXRlbXM6IFtcbiAgICAgICAgICAgIHsgdGV4dDogJ0Jhc2ljIEFwcGxpY2F0aW9uJywgbGluazogJy9leGFtcGxlcy9iYXNpYy1hcHAnIH0sXG4gICAgICAgICAgICB7IHRleHQ6ICdDUlVEIEFQSScsIGxpbms6ICcvZXhhbXBsZXMvY3J1ZC1hcGknIH0sXG4gICAgICAgICAgICB7IHRleHQ6ICdNdWx0aS1TZXJ2aWNlJywgbGluazogJy9leGFtcGxlcy9tdWx0aS1zZXJ2aWNlJyB9LFxuICAgICAgICAgICAgeyB0ZXh0OiAnV2ViU29ja2V0IENoYXQnLCBsaW5rOiAnL2V4YW1wbGVzL3dlYnNvY2tldC1jaGF0JyB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0ZXh0OiAnQUkgRG9jdW1lbnRhdGlvbicsXG4gICAgICAgICAgY29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgICBpdGVtczogW3sgdGV4dDogJ0FJIERvY3VtZW50YXRpb24nLCBsaW5rOiAnL2FpLWRvY3MnIH1dLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdGV4dDogJ1BlcmZvcm1hbmNlJyxcbiAgICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICAgIGl0ZW1zOiBbeyB0ZXh0OiAnQmVuY2htYXJrcycsIGxpbms6ICcvYmVuY2htYXJrcycgfV0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0ZXh0OiAnUHJvamVjdCcsXG4gICAgICAgICAgY29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgICBpdGVtczogW3sgdGV4dDogJ1JvYWRtYXAnLCBsaW5rOiAnL3JvYWRtYXAnIH1dLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9LFxuXG4gICAgLy8gU29jaWFsIGxpbmtzXG4gICAgc29jaWFsTGlua3M6IFtcbiAgICAgIHsgaWNvbjogJ2dpdGh1YicsIGxpbms6ICdodHRwczovL2dpdGh1Yi5jb20vUmVtUnlhaGlyZXYvb25lYnVuJyB9LFxuICAgIF0sXG5cbiAgICAvLyBGb290ZXJcbiAgICBmb290ZXI6IHtcbiAgICAgIG1lc3NhZ2U6ICdSZWxlYXNlZCB1bmRlciB0aGUgTVBMLTIuMCBMaWNlbnNlLicsXG4gICAgICBjb3B5cmlnaHQ6ICdDb3B5cmlnaHQgXHUwMEE5IDIwMjQtcHJlc2VudCBSZW1SeWFoaXJldicsXG4gICAgfSxcblxuICAgIC8vIFNlYXJjaFxuICAgIHNlYXJjaDoge1xuICAgICAgcHJvdmlkZXI6ICdsb2NhbCcsXG4gICAgfSxcblxuICAgIC8vIEVkaXQgbGlua1xuICAgIGVkaXRMaW5rOiB7XG4gICAgICBwYXR0ZXJuOiAnaHR0cHM6Ly9naXRodWIuY29tL1JlbVJ5YWhpcmV2L29uZWJ1bi9lZGl0L21hc3Rlci9kb2NzLzpwYXRoJyxcbiAgICAgIHRleHQ6ICdFZGl0IHRoaXMgcGFnZSBvbiBHaXRIdWInLFxuICAgIH0sXG5cbiAgICAvLyBPdXRsaW5lIGRlcHRoXG4gICAgb3V0bGluZToge1xuICAgICAgbGV2ZWw6IFsyLCAzXSxcbiAgICB9LFxuICB9LFxuXG4gIC8vIEhlYWQgdGFnc1xuICBoZWFkOiBbXG4gICAgWydsaW5rJywgeyByZWw6ICdpY29uJywgdHlwZTogJ2ltYWdlL3BuZycsIGhyZWY6ICcvbG9nby5wbmcnIH1dLFxuICAgIFsnbWV0YScsIHsgbmFtZTogJ3RoZW1lLWNvbG9yJywgY29udGVudDogJyM2NDZjZmYnIH1dLFxuICAgIFsnbWV0YScsIHsgcHJvcGVydHk6ICdvZzp0eXBlJywgY29udGVudDogJ3dlYnNpdGUnIH1dLFxuICAgIFsnbWV0YScsIHsgcHJvcGVydHk6ICdvZzp0aXRsZScsIGNvbnRlbnQ6ICdPbmVCdW4gRnJhbWV3b3JrJyB9XSxcbiAgICBbJ21ldGEnLCB7IHByb3BlcnR5OiAnb2c6ZGVzY3JpcHRpb24nLCBjb250ZW50OiAnQSBidW4uanMgZnJhbWV3b3JrIGluc3BpcmVkIGJ5IG5lc3QuanMgd2l0aCBlZmZlY3QudHMnIH1dLFxuICAgIC8vIFBsYXVzaWJsZSBhbmFseXRpY3NcbiAgICBbJ3NjcmlwdCcsIHsgYXN5bmM6ICcnLCBzcmM6ICdodHRwczovL3BsYXVzaWJsZS5pby9qcy9wYS1Nek9iU0lCcGV5M0xWb3VNVlFtYTQuanMnIH1dLFxuICAgIFsnc2NyaXB0Jywge30sICd3aW5kb3cucGxhdXNpYmxlPXdpbmRvdy5wbGF1c2libGV8fGZ1bmN0aW9uKCl7KHBsYXVzaWJsZS5xPXBsYXVzaWJsZS5xfHxbXSkucHVzaChhcmd1bWVudHMpfSxwbGF1c2libGUuaW5pdD1wbGF1c2libGUuaW5pdHx8ZnVuY3Rpb24oaSl7cGxhdXNpYmxlLm89aXx8e319O3BsYXVzaWJsZS5pbml0KCknXSxcbiAgXSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUEyUyxTQUFTLG9CQUFvQjtBQUN4VSxPQUFPLGFBQWE7QUFFcEIsSUFBTyxpQkFBUSxhQUFhO0FBQUE7QUFBQSxFQUUxQixNQUFNO0FBQUEsSUFDSixTQUFTLENBQUMsUUFBUSxDQUFDO0FBQUEsRUFDckI7QUFBQSxFQUVBLE9BQU87QUFBQSxFQUNQLGFBQWE7QUFBQTtBQUFBLEVBR2IsTUFBTTtBQUFBO0FBQUEsRUFHTixXQUFXO0FBQUE7QUFBQSxFQUdYLGFBQWE7QUFBQTtBQUFBLEVBR2IsVUFB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
