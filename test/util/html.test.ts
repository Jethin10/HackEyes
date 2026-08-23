import { describe, expect, it } from 'vitest';
import { MAX_TEXT_CHARS, htmlToText } from '../../src/util/html.js';

const SAMPLE = `
<html>
  <head><title>HackX</title><style>body { color: red; }</style></head>
  <header>Site nav junk</header>
  <nav>Menu Menu Menu</nav>
  <body>
    <script>trackMe('nope');</script>
    <noscript>enable js</noscript>
    <h1>HackX 2026</h1>
    <p>Round 1 closes 2nd September.</p>
    <ul><li>5-slide deck</li><li>200-word abstract</li></ul>
    <footer>Copyright etc</footer>
  </body>
</html>`;

describe('htmlToText', () => {
  it('strips script/style/nav/footer/header content', () => {
    const out = htmlToText(SAMPLE);
    expect(out).not.toContain('trackMe');
    expect(out).not.toContain('color: red');
    expect(out).not.toContain('Site nav junk');
    expect(out).not.toContain('Copyright');
    expect(out).toContain('HackX 2026');
    expect(out).toContain('Round 1 closes 2nd September.');
    expect(out).toContain('5-slide deck');
  });

  it('collapses whitespace runs to single spaces', () => {
    const out = htmlToText('<p>a\n\t   b</p><p>c</p>');
    expect(out).toBe('a b c');
    expect(out).not.toMatch(/\s{2,}/);
  });

  it('caps output at MAX_TEXT_CHARS', () => {
    const huge = `<p>${'x'.repeat(MAX_TEXT_CHARS + 5000)}</p>`;
    expect(htmlToText(huge).length).toBe(MAX_TEXT_CHARS);
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});
