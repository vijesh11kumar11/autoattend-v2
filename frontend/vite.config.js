import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";

/**
 * Subresource Integrity (SRI) plugin for the production bundle.
 *
 * Walks every emitted asset whose name appears as a <script src> or
 * <link href> in the generated index.html and injects an
 * `integrity="sha384-..."` attribute computed over the asset's bytes.
 * Browsers will refuse to execute / apply the resource if its contents
 * differ at load time (defends against compromised CDNs / MITM on
 * cache-control: public assets).
 *
 * Limitations:
 *   - Same-origin assets only (cross-origin scripts also need
 *     crossorigin="anonymous" — we add it when missing).
 *   - Inline <script> tags are left untouched.
 */
function sriPlugin() {
  return {
    name: "html-sri",
    enforce: "post",
    apply: "build",
    generateBundle(_options, bundle) {
      const integrityByFile = {};
      for (const [fileName, asset] of Object.entries(bundle)) {
        const source =
          asset.type === "asset"
            ? asset.source
            : asset.code; // chunk
        if (source == null) continue;
        const buf =
          typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
        const hash = createHash("sha384").update(buf).digest("base64");
        integrityByFile[fileName] = `sha384-${hash}`;
      }

      const indexAsset = bundle["index.html"];
      if (!indexAsset || indexAsset.type !== "asset") return;

      let html = indexAsset.source.toString();

      // Inject integrity into <script src="..."> and <link href="..."> tags
      // that point at one of our emitted assets. Skip tags that already
      // declare integrity.
      html = html.replace(
        /<(script|link)\b([^>]*?)\s(?:src|href)\s*=\s*"([^"]+)"([^>]*)>/g,
        (match, tag, before, url, after) => {
          if (/\sintegrity\s*=/.test(match)) return match;
          // Match by file name component (strip leading ./ and absolute origins)
          const fileName = url.replace(/^\/+|^\.\/+/, "").replace(/^[a-z]+:\/\/[^/]+\//i, "");
          const hash = integrityByFile[fileName];
          if (!hash) return match;
          const needsCrossOrigin = !/\scrossorigin\s*=/.test(match);
          const co = needsCrossOrigin ? ' crossorigin="anonymous"' : "";
          return `<${tag}${before} ${tag === "script" ? "src" : "href"}="${url}"${after} integrity="${hash}"${co}>`;
        },
      );

      indexAsset.source = html;
    },
  };
}

export default defineConfig({
  plugins: [react(), sriPlugin()],
  server: {
    port: 5173,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options":        "DENY",
      "Referrer-Policy":        "strict-origin-when-cross-origin",
    },
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
