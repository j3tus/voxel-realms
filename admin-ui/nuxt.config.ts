// Voxel Realms admin: static SPA served by the game server at /admin/ (no SSR, hash routing so the server needs no fallback)
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  devtools: { enabled: false },
  telemetry: false,
  css: ['~/assets/css/main.css'],
  app: {
    baseURL: '/admin/',
    head: {
      title: 'Voxel Realms · Admin',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }, { name: 'theme-color', content: '#070b13' }, { name: 'robots', content: 'noindex' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/admin/favicon.svg' }, { rel: 'preconnect', href: 'https://fonts.googleapis.com' }, { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap' }],
    },
  },
  router: { options: { hashMode: true } },
  nitro: { preset: 'static' },
  experimental: { payloadExtraction: false },
})
