import { describe, it, expect } from 'vitest';
import { markdownToHtml, escapeHtml, inlineMarkup } from '../lib/markdown-to-html';

/**
 * Drive converts an uploaded HTML file into a Google Doc. This is what turns a
 * changelog draft into something worth reading in that Doc rather than a wall
 * of asterisks and hashes.
 */

describe('escapeHtml', () => {
  it('escapes before any markup is expanded', () => {
    // Otherwise a draft mentioning <script> or a generic like Array<T> becomes
    // markup in someone's document.
    expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });
});

describe('inlineMarkup', () => {
  it('handles bold, code and links', () => {
    expect(inlineMarkup('**bold**')).toBe('<strong>bold</strong>');
    expect(inlineMarkup('`code`')).toBe('<code>code</code>');
    expect(inlineMarkup('[docs](https://x.test/a)')).toBe('<a href="https://x.test/a">docs</a>');
  });

  it('does not read markup inside inline code', () => {
    expect(inlineMarkup('`**not bold**`')).toBe('<code>**not bold**</code>');
  });
});

describe('markdownToHtml', () => {
  it('renders the shape a standalone changelog actually produces', () => {
    const html = markdownToHtml([
      '# A succinct title',
      '',
      'One paragraph of teaser text.',
      '',
      "## What's Changing",
      '',
      '- First impact',
      '- Second impact',
      '',
      'Run `npm install -g @hubspot/cli` to update.',
      '',
      '---',
      '**Meta Description:** Something short.',
    ].join('\n'));

    expect(html).toContain('<h1>A succinct title</h1>');
    expect(html).toContain('<h2>What&#39;s Changing</h2>'.replace('&#39;', "'"));
    expect(html).toContain('<li>First impact</li>');
    expect(html).toContain('<code>npm install -g @hubspot/cli</code>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<strong>Meta Description:</strong>');
  });

  it('closes a list before the next heading', () => {
    const html = markdownToHtml('- one\n- two\n\n## Next');
    expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('<h2>'));
  });

  it('keeps fenced code literal, including things that look like markup', () => {
    const html = markdownToHtml('```\n# not a heading\n- not a bullet\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('# not a heading');
    expect(html).not.toContain('<h1>');
    expect(html).not.toContain('<li>');
  });

  it('keeps a line it does not understand rather than dropping it', () => {
    // Losing part of someone's draft is worse than rendering it plainly.
    const html = markdownToHtml('> a blockquote it has no rule for');
    expect(html).toContain('a blockquote it has no rule for');
  });

  it('survives empty input', () => {
    expect(markdownToHtml('')).toContain('<body>');
    expect(markdownToHtml('')).toContain('</html>');
  });
});
