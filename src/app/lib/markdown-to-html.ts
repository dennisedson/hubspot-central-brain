/**
 * Enough Markdown to render a changelog draft as a Google Doc.
 *
 * Drive converts an uploaded file to a Doc when the target mimeType is
 * `application/vnd.google-apps.document`, and HTML is a documented source
 * format. Markdown's status is not: the guide's prose lists it while the MIME
 * table does not, so this converts rather than gambling on it.
 *
 * Deliberately small. It handles what the changelog prompts actually produce —
 * headings, bold, links, bullets, fenced code, rules, paragraphs — and nothing
 * else. A general Markdown library would be a dependency, a bundle, and a
 * larger surface to be wrong in, for a document a person reviews anyway.
 *
 * Anything it does not recognise survives as paragraph text rather than being
 * dropped. Losing a line of someone's draft is worse than rendering it plainly.
 */

/** HTML-escapes text. Applied before any inline markup is expanded. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Bold, inline code and links — applied to already-escaped text.
 *
 * Code spans are lifted out before anything else runs and put back afterwards.
 * Converting them in place is not enough: the bold and link patterns still
 * match through the resulting tags, so `**not bold**` inside backticks came out
 * emphasised. Code means "leave this exactly as written", and this is the only
 * way to mean it.
 */
export function inlineMarkup(text: string): string {
  const spans: string[] = [];
  // A private-use codepoint, not a control character: it cannot appear in
  // escaped HTML, so the placeholder cannot collide with the text or be matched
  // by the patterns below, and it does not trip no-control-regex.
  const withPlaceholders = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    spans.push(code);
    return `\uE000${spans.length - 1}\uE000`;
  });

  const marked = withPlaceholders
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');

  return marked.replace(/\uE000(\d+)\uE000/g, (_match, index: string) =>
    `<code>${spans[Number(index)]}</code>`);
}

export function markdownToHtml(markdown: string): string {
  const lines = (markdown ?? '').split('\n');
  const out: string[] = [];
  let inList = false;
  let inCode = false;

  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    // Fenced code: everything inside is literal, including things that look
    // like headings or bullets.
    if (/^```/.test(line)) {
      if (inCode) { out.push('</pre>'); inCode = false; }
      else { closeList(); out.push('<pre>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escapeHtml(raw)); continue; }

    if (line.trim() === '') { closeList(); continue; }

    if (/^---+$/.test(line.trim())) { closeList(); out.push('<hr>'); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkup(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMarkup(escapeHtml(bullet[1]))}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inlineMarkup(escapeHtml(line))}</p>`);
  }

  closeList();
  if (inCode) out.push('</pre>');

  return `<!DOCTYPE html><html><body>\n${out.join('\n')}\n</body></html>`;
}
