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
  img: ['src', 'alt', 'title', 'width', 'height'],
  table: ['border', 'cellpadding', 'cellspacing'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
};

export function sanitizeRichText(input: string | null | undefined) {
  if (input === undefined) {
    return undefined;
  }

  if (input === null) {
    return null;
  }

  const sanitized = sanitizeHtml(input, {
    allowedTags,
    allowedAttributes,
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
