-- Normalize legacy rich text that was saved with escaped HTML entities.
-- Safe to run multiple times. The inner '&amp;' replacement also handles double-escaped values like '&amp;lt;h1&amp;gt;'.

UPDATE products
SET description = REPLACE(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(description, '&amp;', '&'),
          '&lt;', '<'
        ),
        '&gt;', '>'
      ),
      '&quot;', '"'
    ),
    '&#39;', ''''
  ),
  '&nbsp;', ' '
)
WHERE description IS NOT NULL
  AND (
    description LIKE '%&amp;lt;%'
    OR description LIKE '%&amp;gt;%'
    OR description LIKE '%&lt;%'
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
          REPLACE(category_description, '&amp;', '&'),
          '&lt;', '<'
        ),
        '&gt;', '>'
      ),
      '&quot;', '"'
    ),
    '&#39;', ''''
  ),
  '&nbsp;', ' '
)
WHERE category_description IS NOT NULL
  AND (
    category_description LIKE '%&amp;lt;%'
    OR category_description LIKE '%&amp;gt;%'
    OR category_description LIKE '%&lt;%'
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
          REPLACE(content, '&amp;', '&'),
          '&lt;', '<'
        ),
        '&gt;', '>'
      ),
      '&quot;', '"'
    ),
    '&#39;', ''''
  ),
  '&nbsp;', ' '
)
WHERE content IS NOT NULL
  AND (
    content LIKE '%&amp;lt;%'
    OR content LIKE '%&amp;gt;%'
    OR content LIKE '%&lt;%'
    OR content LIKE '%&gt;%'
    OR content LIKE '%&quot;%'
    OR content LIKE '%&#39;%'
    OR content LIKE '%&nbsp;%'
  );
