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
  it('unwraps SnapGene rich text', () => {
    expect(stripHtml('<html><body>mammalian codon-optimized</body></html>')).toBe(
      'mammalian codon-optimized',
    );
    expect(stripHtml('&lt;html&gt;&lt;body&gt;a &amp; b&lt;/body&gt;&lt;/html&gt;')).toBe('a & b');
    expect(stripHtml('line1<br>line2<p>para</p>')).toBe('line1\nline2\npara');
    expect(stripHtml('plain text')).toBe('plain text');
  });
});
