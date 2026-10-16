import {
  childElements,
  decodeEntities,
  firstChild,
  parseXml,
  stripHtml,
  textOf,
  XmlError,
} from './xml';

describe('parseXml', () => {
  it('parses elements, attributes, text and entities', () => {
    const root = parseXml(
      '<?xml version="1.0"?><Features nextValidID="8"><Feature name="a &amp; b" type="CDS"><Q name="note"><V text="&lt;html&gt;x&lt;/html&gt;"/></Q>tail</Feature><!-- c --><E/></Features>',
    );
    expect(root.name).toBe('Features');
    expect(root.attributes).toEqual({ nextValidID: '8' });
    const feature = firstChild(root, 'Feature');
    expect(feature?.attributes).toEqual({ name: 'a & b', type: 'CDS' });
    expect(textOf(feature)).toBe('tail');
    expect(firstChild(firstChild(feature ?? root, 'Q') ?? root, 'V')?.attributes['text']).toBe(
      '<html>x</html>',
    );
    expect(childElements(root).map((e) => e.name)).toEqual(['Feature', 'E']);
  });

  it('tolerates raw > inside attribute values, CDATA and BOMs', () => {
    const root = parseXml(
      String.fromCharCode(0xfeff) +
        '<Notes><Description>&lt;html>&lt;body>Hi&lt;/body>&lt;/html></Description><X><![CDATA[a<b&c]]></X></Notes>',
    );
    expect(textOf(firstChild(root, 'Description'))).toBe('<html><body>Hi</body></html>');
    expect(textOf(firstChild(root, 'X'))).toBe('a<b&c');
  });

  it('decodes numeric entities and rejects malformed documents', () => {
    expect(decodeEntities('&#65;&#x42;&quot;&unknown;')).toBe('AB"&unknown;');
    expect(() => parseXml('<a><b></a>')).toThrow(XmlError);
    expect(() => parseXml('<a>')).toThrow(XmlError);
    expect(() => parseXml('plain')).toThrow(XmlError);
    expect(() => parseXml('<a x=1/>')).toThrow(XmlError);
  });
});

describe('stripHtml', () => {
  it('unwraps SnapGene rich text and decodes its entities once', () => {
    expect(stripHtml('<html><body>mammalian codon-optimized</body></html>')).toBe(
      'mammalian codon-optimized',
    );
    expect(stripHtml('<html><body><p>a &amp; b</p><p>&amp;lt;</p></body></html>')).toBe(
      'a & b\n&lt;',
    );
    expect(stripHtml('<html><body>line1<br>line2<p>para</p></body></html>')).toBe(
      'line1\nline2\npara',
    );
  });

  it('leaves text without the wrapper alone', () => {
    expect(stripHtml('plain text')).toBe('plain text');
    expect(stripHtml('a <b>bold</b> &amp; c')).toBe('a <b>bold</b> &amp; c');
    expect(stripHtml('x < y & z')).toBe('x < y & z');
  });

  it('keeps literal markup and entities that parseXml decoded', () => {
    const root = parseXml('<a v="&lt;b&gt;x&amp;amp;&lt;/b&gt;">&lt;i&gt;y&amp;amp;</a>');
    expect(stripHtml(root.attributes['v'] ?? '')).toBe('<b>x&amp;</b>');
    expect(stripHtml(textOf(root))).toBe('<i>y&amp;');
  });
});
