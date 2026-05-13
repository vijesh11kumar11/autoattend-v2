/**
 * MermaidRenderer — renders raw Mermaid.js diagram code inside a
 * sandboxed iframe so the host page never executes arbitrary diagram
 * markup. Uses the CDN-hosted Mermaid build (no extra npm dep).
 *
 * Pass `code` (the raw mermaid source) and the iframe handles the rest.
 */

import { useMemo } from 'react';

const SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';

// Escape so the user-provided diagram code can't break out of the
// <div class="mermaid"> wrapper. Mermaid uses '<' for arrows but inside
// a <div> we want it literal; we keep '<', '>' but escape script-y bits.
function safeForHtml(code) {
  return String(code || '')
    .replaceAll('<script', '&lt;script')
    .replaceAll('</script', '&lt;/script');
}

export function MermaidRenderer({ code, minHeight = 200 }) {
  const srcDoc = useMemo(() => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<script src="${SCRIPT_URL}"></script>
<style>
  html, body { margin: 0; padding: 0; background: white; }
  body { display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: sans-serif; }
  .mermaid { max-width: 100%; }
  .err { color: #b91c1c; font-size: 12px; padding: 10px; }
</style>
</head>
<body>
<div class="mermaid">${safeForHtml(code)}</div>
<script>
  try {
    mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'strict' });
  } catch (e) {
    document.body.innerHTML = '<div class="err">Mermaid failed to render: ' + (e && e.message) + '</div>';
  }
</script>
</body>
</html>`, [code]);

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      title="Mermaid Diagram"
      className="w-full border-0 rounded bg-white"
      style={{ minHeight }}
    />
  );
}

export default MermaidRenderer;
