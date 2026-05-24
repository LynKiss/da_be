-- Normalize legacy rich text that was saved with escaped HTML entities.
-- Safe to run multiple times: after the first pass, matching patterns disappear.

UPDATE products
SET description = REPLACE(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(description, '&lt;', '<'),
          '&gt;', '>'
        ),
        '&quot;', '"'
      ),
      '&#39;', ''''
    ),
    '&nbsp;', ' '
  ),
  '&amp;', '&'
)
WHERE description IS NOT NULL
  AND (
    description LIKE '%&lt;%'
    OR description LIKE '%&gt;%'
    OR description LIKE '%&quot;%'
    OR description LIKE '%&#39;%'
    OR description LIKE '%&nbsp;%'
  );

UPDATE categories
SET category_description = REPLACE(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(category_description, '&lt;', '<'),
          '&gt;', '>'
        ),
        '&quot;', '"'
      ),
      '&#39;', ''''
    ),
    '&nbsp;', ' '
  ),
  '&amp;', '&'
)
WHERE category_description IS NOT NULL
  AND (
    category_description LIKE '%&lt;%'
    OR category_description LIKE '%&gt;%'
    OR category_description LIKE '%&quot;%'
    OR category_description LIKE '%&#39;%'
    OR category_description LIKE '%&nbsp;%'
  );

UPDATE news
SET content = REPLACE(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(content, '&lt;', '<'),
          '&gt;', '>'
        ),
        '&quot;', '"'
      ),
      '&#39;', ''''
    ),
    '&nbsp;', ' '
  ),
  '&amp;', '&'
)
WHERE content IS NOT NULL
  AND (
    content LIKE '%&lt;%'
    OR content LIKE '%&gt;%'
    OR content LIKE '%&quot;%'
    OR content LIKE '%&#39;%'
    OR content LIKE '%&nbsp;%'
  );
