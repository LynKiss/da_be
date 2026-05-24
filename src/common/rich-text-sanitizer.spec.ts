import { sanitizeRichText } from './rich-text-sanitizer';

describe('sanitizeRichText', () => {
  it('decodes escaped rich text once before sanitizing', () => {
    expect(sanitizeRichText('&lt;h1&gt;Tiêu đề&lt;/h1&gt;&lt;p&gt;Nội dung&lt;/p&gt;')).toBe(
      '<h1>Tiêu đề</h1><p>Nội dung</p>',
    );
  });

  it('removes script tags and event handler attributes', () => {
    const result = sanitizeRichText(
      '<p>Hợp lệ</p><script>alert(1)</script><img src="https://cdn.example.com/a.png" onerror="alert(1)">',
    );

    expect(result).toContain('<p>Hợp lệ</p>');
    expect(result).toContain('<img src="https://cdn.example.com/a.png" />');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('onerror');
  });

  it('keeps only the safe style subset used by product descriptions', () => {
    const result = sanitizeRichText(
      '<p style="text-align:center;color:red">A</p><img src="https://cdn.example.com/a.png" style="width:1000px;height:1000px;position:absolute">',
    );

    expect(result).toContain('style="text-align:center"');
    expect(result).toContain('style="width:1000px;height:1000px"');
    expect(result).not.toContain('color:red');
    expect(result).not.toContain('position:absolute');
  });

  it('keeps relative product image urls', () => {
    expect(sanitizeRichText('<img src="/upload/cdn/images/product.png" alt="Ảnh">')).toBe(
      '<img src="/upload/cdn/images/product.png" alt="Ảnh" />',
    );
  });
});
