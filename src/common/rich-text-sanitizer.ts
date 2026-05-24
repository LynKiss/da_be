import sanitizeHtml from 'sanitize-html';

const allowedTags = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'a',
  'span',
  'div',
  'pre',
  'code',
];

const allowedAttributes: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'style'],
  table: ['border', 'cellpadding', 'cellspacing', 'style'],
  th: ['colspan', 'rowspan', 'style'],
  td: ['colspan', 'rowspan', 'style'],
  p: ['style'],
  h1: ['style'],
  h2: ['style'],
  h3: ['style'],
  div: ['style'],
  span: ['style'],
};

function decodeHtmlEntitiesOnce(input: string) {
  if (!/[&](lt|gt|amp|quot|#39|nbsp);/i.test(input)) {
    return input;
  }

  return input
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

export function sanitizeRichText(input: string | null | undefined) {
  if (input === undefined) {
    return undefined;
  }

  if (input === null) {
    return null;
  }

  const decoded = decodeHtmlEntitiesOnce(input);

  const sanitized = sanitizeHtml(decoded, {
    allowedTags,
    allowedAttributes,
    allowedStyles: {
      '*': {
        'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
        width: [/^\d+(px|%)$/],
        height: [/^\d+(px|%)$/],
        'max-width': [/^\d+(px|%)$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer',
        target: '_blank',
      }),
    },
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
  }).trim();

  return sanitized.length > 0 ? sanitized : null;
}
