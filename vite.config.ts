import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Comic Helper',
        short_name: 'ComicHelper',
        description: 'Pixel art webtoon composer',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        // `fullscreen` hides the OS status/nav bars on Android. iOS Safari
        // ignores this and uses `apple-mobile-web-app-capable` (added to
        // index.html) plus a `black-translucent` status bar style to give
        // the closest-to-fullscreen experience available on iOS.
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone', 'minimal-ui'],
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
