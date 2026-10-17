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

describe('decodeEntities', () => {
  it('decodes every named, decimal and hex reference, in either case', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
    expect(decodeEntities('&nbsp;')).toBe(String.fromCharCode(160));
    expect(decodeEntities('&AMP;&Lt;')).toBe('&<');
    expect(decodeEntities('&#65;&#x41;&#X42;&#xe9;')).toBe('AABé');
  });

  it('leaves unknown, unterminated and bare ampersands alone', () => {
    expect(decodeEntities('plain')).toBe('plain');
    expect(decodeEntities('a & b &unknown; &amp c &#;')).toBe('a & b &unknown; &amp c &#;');
    expect(decodeEntities('&amp;amp;')).toBe('&amp;');
  });
});

describe('parseXml structure and errors', () => {
  it('reads single- and double-quoted attributes with whitespace around the equals sign', () => {
    const root = parseXml('<a  x = "1"  y= \'two "q"\' z ="3" w=\'&lt;\' />');
    expect(root.attributes).toEqual({ x: '1', y: 'two "q"', z: '3', w: '<' });
    expect(root.children).toEqual([]);
  });

  it('keeps children in order and creates no empty text nodes', () => {
    const root = parseXml('<a><b/><c></c>x<d>y</d><!-- c -->z<?pi q?>w</a>');
    expect(root.children.map((c) => (typeof c === 'string' ? c : c.name))).toEqual([
      'b',
      'c',
      'x',
      'd',
      'zw',
    ]);
    expect(parseXml('<a>x<b/>y</a>').children).toHaveLength(3);
    expect(parseXml('<a>-->x<!-- c -->y</a>').children).toEqual(['-->xy']);
    expect(parseXml('<a>?>x<?p q?>y</a>').children).toEqual(['?>xy']);
    expect(textOf(parseXml('<a>1<![CDATA[<&>]]>2&amp;</a>'))).toBe('1<&>2&');
  });

  it('skips a prolog of whitespace, instructions, comments and a doctype', () => {
    const root = parseXml('  \n<?a b?><?c d?> <!-- one --><!-- two -->\n<!DOCTYPE r [x]><r/>\n ');
    expect(root.name).toBe('r');
    expect(() => parseXml('<?xml?>')).toThrow('XML error at offset 7: expected a root element');
  });

  it('strips a byte order mark before reading offsets', () => {
    expect(() => parseXml('\ufeffplain')).toThrow('XML error at offset 0: expected a root element');
    expect(parseXml('\ufeff<r/>').name).toBe('r');
  });

  it('reports each malformation with its message and offset', () => {
    const fail = (xml: string): string => {
      try {
        parseXml(xml);
      } catch (e) {
        expect(e).toBeInstanceOf(XmlError);
        expect((e as XmlError).name).toBe('XmlError');
        return (e as Error).message;
      }
      return 'no error';
    };
    expect(fail('plain')).toBe('XML error at offset 0: expected a root element');
    expect(fail('<a><1/></a>')).toBe('XML error at offset 4: expected a name');
    expect(fail('<a x/>')).toBe('XML error at offset 4: attribute "x" has no value');
    expect(fail('<a x=1/>')).toBe('XML error at offset 5: attribute value must be quoted');
    expect(fail('<a x=/>')).toBe('XML error at offset 5: attribute value must be quoted');
    expect(fail('<a x="1/>')).toBe('XML error at offset 6: expected """');
    expect(fail('<a x="1"?>')).toBe('XML error at offset 8: malformed start tag <a>');
    expect(fail('<a>text')).toBe('XML error at offset 7: unclosed element <a>');
    expect(fail('<a>')).toBe('XML error at offset 3: unclosed element <a>');
    expect(fail('<a><b></a>')).toBe('XML error at offset 9: expected </b> but found </a>');
    expect(fail('</a>')).toBe('XML error at offset 1: expected a name');
    expect(fail('<a></a x>')).toBe('XML error at offset 7: malformed end tag </a>');
    expect(fail('<a><!-- x</a>')).toBe('XML error at offset 7: expected "-->"');
    expect(fail('<a><?x</a>')).toBe('XML error at offset 5: expected "?>"');
    expect(fail('<a><![CDATA[x</a>')).toBe('XML error at offset 12: expected "]]>"');
    expect(fail('<!-- x<a/>')).toBe('XML error at offset 4: expected "-->"');
    expect(fail('<!DOCTYPE x')).toBe('XML error at offset 2: expected ">"');
    expect(fail('<a/>x')).toBe('XML error at offset 4: content after the root element');
    expect(fail('<a/><b/>')).toBe('XML error at offset 4: content after the root element');
  });

  it('accepts whitespace in end tags and after the root', () => {
    expect(parseXml('<a></a >\n\t').name).toBe('a');
    expect(parseXml('<a x="1" ></a>').attributes).toEqual({ x: '1' });
  });
});

describe('childElements', () => {
  it('lists element children only, optionally by name', () => {
    const root = parseXml('<a>t<b/>u<c/><b x="1"/></a>');
    expect(childElements(root).map((e) => e.name)).toEqual(['b', 'c', 'b']);
    expect(childElements(root, 'b')).toHaveLength(2);
    expect(childElements(root, 'zz')).toEqual([]);
    expect(firstChild(root, 'b')?.attributes).toEqual({});
    expect(firstChild(root, 'zz')).toBeUndefined();
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

  it('recognises the wrapper through whitespace and attributes only', () => {
    expect(stripHtml('  \n<HTML lang="en"><body>x</body></HTML>')).toBe('x');
    expect(stripHtml('<html>x</html>')).toBe('x');
    expect(stripHtml('<htmlx>a</htmlx>')).toBe('<htmlx>a</htmlx>');
    expect(stripHtml('  plain  ')).toBe('plain');
    expect(stripHtml('x <html>y</html>')).toBe('x <html>y</html>');
  });

  it('turns paragraphs and breaks into single newlines and drops other tags', () => {
    expect(
      stripHtml('<html><p class="a" id="b">one</p>\n \n<P>two</P><br/><br />three</html>'),
    ).toBe('one\ntwo\nthree');
    expect(stripHtml('<html>a<p class="x">b</html>')).toBe('a\nb');
    expect(stripHtml('<html><body><pre>a</pre><b x="y">b</b></body></html>')).toBe('ab');
    expect(stripHtml('<html>a \t\n\t \n\n b</html>')).toBe('a\nb');
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
