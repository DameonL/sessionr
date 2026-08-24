import { defineConfig } from '@vite-pwa/assets-generator/config'

/**
 * Regenerates the PWA icon set from one master image. Run via `npm run generate-pwa-assets`;
 * it is NOT part of `npm run build`, so the committed PNGs in public/ are what ship.
 *
 * The master lives outside public/ so the 2.6 MB source never reaches the CDN or the
 * service worker precache. It was extracted from the old public/favicon.svg, which was not
 * vector at all — it wrapped the same 2048x2048 PNG twice, which is why it weighed 7 MB.
 */
export default defineConfig({
  images: ['assets-src/logo-2048.png'],
  preset: {
    // The master already carries ~33% margin (measured: the logo's ink spans 66.7% of the
    // canvas), so the plain icons need no further inset.
    transparent: {
      sizes: [192, 512],
      padding: 0,
    },
    /**
     * Android 8+ renders launcher icons through an arbitrary mask, so everything meaningful
     * must sit inside a circle of radius 40% of the width. Measured on the master, the
     * furthest ink is at radius 44.3% — just outside it. `padding` here scales content to
     * (1 - padding) of the canvas, so 0.15 brings that to 37.7%: inside the safe circle with
     * room to spare, while still filling the icon.
     *
     * Recompute this if the master is ever replaced; do not assume 0.15 still fits.
     */
    maskable: {
      sizes: [512],
      padding: 0.15,
      resizeOptions: { background: '#ffffff' },
    },
    // padding 0 reproduces the framing of the apple-touch-icon that already ships
    // (measured: ink to 44.5% radius). iOS masks with a rounded rect and crops very
    // little, so it does not need the maskable inset above.
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: { background: '#ffffff' },
    },
    // Keep the filenames the manifest and index.html already use, so adding the maskable
    // variant is the only reference change.
    assetName: (type, size) => {
      switch (type) {
        case 'transparent':
          return `icon-${size.width}x${size.height}.png`
        case 'maskable':
          return `maskable-icon-${size.width}x${size.height}.png`
        case 'apple':
          return 'apple-touch-icon.png'
      }
    },
  },
})
