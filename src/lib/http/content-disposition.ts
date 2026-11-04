/**
 * Build a Content-Disposition header value that supports non-ASCII filenames
 * using RFC 5987 filename*= encoding. Falls back to an ASCII-only filename
 * parameter for legacy browsers.
 */
export function buildContentDisposition(disposition: "attachment" | "inline", fileName: string) {
 const safeName = fileName.replace(/[\r\n"\\]/g, "_");

 // If the name is pure ASCII, use the simple form
 if (/^[\x20-\x7e]*$/.test(safeName)) {
 return `${disposition}; filename="${safeName}"`;
 }

 // RFC 5987: filename*=UTF-8''<percent-encoded>
 // Also provide an ASCII-only fallback filename for legacy browsers
 // RFC 5987 ext-value also escapes the characters encodeURIComponent leaves alone (A11-03).
 const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
 const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, "_");
 return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
