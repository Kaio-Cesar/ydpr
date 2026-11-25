/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves from /<repo>/; the deploy workflow sets BASE_PATH.
const base = process.env.BASE_PATH ?? "/";

/** Strict CSP, added only to built pages (Vite's dev server injects inline styles). */
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const cspPlugin = (): Plugin => ({
  name: "ydpr-csp",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" },
  ],
});

export default defineConfig({
  base,
  build: {
    target: "es2022",
    rollupOptions: { input: { main: "index.html", recover: "recover.html" } },
  },
  plugins: [
    cspPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "You did print it, right?",
        short_name: "YDPR",
        description: "Print recovery codes as QR backup pages, optionally encrypted with age. Works offline.",
        theme_color: "#0d0e11",
        background_color: "#0d0e11",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{html,js,css,svg,png,woff2,txt}"],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        // Activate new versions right away; the page holds no state worth keeping.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
