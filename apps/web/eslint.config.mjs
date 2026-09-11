import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Every <img> in this app points at one of three things: a data: URL (a
      // QR bitmap, or a photograph being previewed before it is uploaded), a
      // Cloudinary URL that is already resized and CDN-served, or /api/uploads
      // on our own API. next/image cannot take a data: URL at all, and putting
      // the other two through Vercel's optimiser would bill a transform per
      // card photograph for images that are already the right size.
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
