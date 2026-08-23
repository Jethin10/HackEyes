import { parse } from 'node-html-parser';

/** Cap sent to the model (Part I §5 cost control). */
export const MAX_TEXT_CHARS = 30_000;

/**
 * Strips a page down to readable text: removes script/style/nav/footer/
 * header (+noscript), collapses all whitespace runs to single spaces, and
 * caps at MAX_TEXT_CHARS. Block-level closing tags become line breaks first
 * so list items don't fuse into one word-salad token.
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|table|ul|ol)>/gi, '\n');

  const root = parse(withBreaks);
  for (const el of root.querySelectorAll(
    'script, style, noscript, nav, footer, header',
  )) {
    el.remove();
  }

  let text = root.text;
  // Newlines survive stripping only as structure hints; final output is
  // single-spaced plain text per spec ("collapse whitespace").
  text = text.replace(/\s+/g, ' ').trim();

  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
  }
  return text;
}
