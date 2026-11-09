import * as PDFLib from 'pdf-lib'
/** fonts 功能模块，通过实时app接口访问其他功能。 */
export const PDFFonts =Object.freeze({create:app=>{
const scope = app.scope;
const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
const fontFaceFamilyCache = new Map();

const getCompleteSimSunVectorFont = (doc, cache, text, weight) => {
      if (![...text.replace(/\n/g, '')].every(char => ORIGINAL_SIMSUN_LATIN.glyphs[char.codePointAt(0)])) return null;
      const key = `original-simsun-latin:${weight}`, existing = cache.get(key);if (existing) return existing;
      const { PDFName, PDFHexString } = PDFLib, context = doc.context, data = app.dataUrlToUint8Array(`data:font/ttf;base64,${ORIGINAL_SIMSUN_LATIN.data}`);
      const metrics = readTrueTypeFont(data), head = new DataView(metrics.tables.get(0x68656164).buffer), hhea = new DataView(metrics.tables.get(0x68686561).buffer), units = metrics.units;
      const glyphs = Object.entries(ORIGINAL_SIMSUN_LATIN.glyphs), widths = glyphs.flatMap(([code, glyph]) => [glyph.id, [glyph.width * 1000 / units]]);
      const stream = context.register(context.flateStream(data, { Length1: data.length })), name = 'OriginalSimSunLatin';
      const ascent = hhea.getInt16(4) * 1000 / units, descent = hhea.getInt16(6) * 1000 / units;
      const descriptor = context.register(context.obj({ Type: 'FontDescriptor', FontName: name, Flags: 5, FontBBox: [36, 38, 40, 42].map(at => head.getInt16(at) * 1000 / units), ItalicAngle: 0, Ascent: ascent, Descent: descent, CapHeight: ascent, StemV: 80, FontFile2: stream }));
      const descendant = context.register(context.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: name, CIDSystemInfo: { Registry: PDFLib.PDFString.of('Adobe'), Ordering: PDFLib.PDFString.of('Identity'), Supplement: 0 }, FontDescriptor: descriptor, DW: 500, W: widths, CIDToGIDMap: 'Identity' }));
      const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /OriginalSimSunLatin def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${glyphs.length} beginbfchar\n${glyphs.map(([code, glyph]) => `<${glyph.id.toString(16).padStart(4, '0')}> <${Number(code).toString(16).padStart(4, '0')}>`).join('\n')}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend end`;
      const unicode = context.register(context.flateStream(app.pdfBinaryStringToBytes(cmap)));
      const ref = context.register(context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: name, Encoding: 'Identity-H', DescendantFonts: [descendant], ToUnicode: unicode }));
      const font = { originalRef: ref, originalSimSunLatin: true, syntheticBold: /bold|[6-9]00/i.test(weight), encodeText: value => PDFHexString.of([...value].map(char => { const glyph = ORIGINAL_SIMSUN_LATIN.glyphs[char.codePointAt(0)];if (!glyph) throw new Error('原宋体拉丁字形不支持该字符');return glyph.id.toString(16).padStart(4, '0'); }).join('')), widthOfTextAtSize: (value, size) => [...value].reduce((sum, char) => sum + (ORIGINAL_SIMSUN_LATIN.glyphs[char.codePointAt(0)]?.width || 0), 0) * size / units, heightAtSize: (size, options = {}) => (ascent - (options.descender === false ? 0 : descent)) * size / 1000 };
      cache.set(key, font);return font;
    };

const AUTOMATIC_FONT_PROGRAMS = app.fontPrograms.original.automatic;

const automaticFontFaces = new Map();

const prepareAutomaticFonts = async () => {
  await app.ensureFontPrograms();
  for (const program of AUTOMATIC_FONT_PROGRAMS) {
    let font = automaticFontFaces.get(program.name);
    if (!font) {
      const data = app.dataUrlToUint8Array(`data:font/ttf;base64,${program.data}`), loadedName = `automatic-${program.name}`;
      font = { name: program.name, aliases: [program.name], kind: program.kind, weight: program.weight, matchFamilies: program.matchFamilies, data, loadedName: '', automatic: true };
      automaticFontFaces.set(program.name, font);
      try { const face = await new FontFace(loadedName, data, { weight: program.weight }).load();document.fonts.add(face);Object.assign(font, { face, loadedName }); } catch { /* 矢量导出仍可使用字体程序。 */ }
    }
    if(font.face)document.fonts.add(font.face);
    importedFontFaces.set(`automatic:${font.name}`, font);
  }
};

const getAutomaticFont = (name, text, weight = 'normal') => {
  const original = findPreparedOriginalFont(name, text);
  if (fontCoversText(original, text)) return original;
  const song=importedFontFaces.get('complete-simsun-latin');
  if(/simsun|stsong|songti/i.test(name)&&fontCoversText(song,text))return song;
  const description=/^(?:CIDFont|Font\d)/i.test(name)?[name,...(original?.aliases||[])].join(' '):name;
  const kind = /mono|courier/i.test(description) ? 'mono' : /sans|arial|helvetica|deng|等线|hei|gothic|yahei|calibri|carlito|tahoma|verdana|segoe|黑体|雅黑/i.test(description) ? 'sans' : 'serif';
  const bold = /bold|black|heavy|[6-9]00/i.test(`${description} ${weight}`) ? 'bold' : 'normal';
  const compatible = [...automaticFontFaces.values()].find(font => font.matchFamilies && new RegExp(font.matchFamilies,'i').test(description) && font.weight === bold && fontCoversText(font,text));
  if(compatible)return compatible;
  return [...automaticFontFaces.values()].find(font => !font.matchFamilies && font.kind === kind && font.weight === bold && fontCoversText(font, text))
    || [...automaticFontFaces.values()].find(font => !font.matchFamilies && font.weight === bold && fontCoversText(font, text))
    || [...importedFontFaces.values()].find(font => !font.matchFamilies && fontCoversText(font, text));
};

const getAutomaticVectorFont = (doc, cache, name, text, weight) => {
  const prepared = getAutomaticFont(name, text, weight);
  if (prepared) {
    const font = getPreparedOriginalVectorFont(doc, cache, prepared.name, text);
    if (font) return { ...font, nativeBold: /bold/i.test(prepared.name), automaticFontName: prepared.name };
  }
  const candidates = [...importedFontFaces.values()], groups = new Map();
  const select = char => candidates.find(font => originalFontKey(font.name) === originalFontKey(name) && fontCoversText(font, char)) || getAutomaticFont(name, char, weight);
  for (const char of new Set(text.replace(/\n/g, ''))) { const font = select(char);if (!font) return null;if (!groups.has(font)) groups.set(font, '');groups.set(font, groups.get(font) + char); }
  const vectors = new Map([...groups].map(([font, chars]) => [font, getPreparedOriginalVectorFont(doc, cache, font.name, chars)]));
  if ([...vectors.values()].some(font => !font)) return null;
  const runs = value => { const list = [];for (const char of value) { const font = vectors.get(select(char));if (!font) throw new Error('字体字符集合发生变化');if (list.at(-1)?.font === font) list.at(-1).text += char;else list.push({ font, text: char }); }return list; };
  const fonts = [...vectors.values()];
  return { originalFonts: fonts, runs, automaticFontName: [...groups.keys()].map(font => font.name).join(', '),
    encodeText: value => { runs(value);return PDFLib.PDFHexString.of(''); },
    widthOfTextAtSize: (value, size) => runs(value).reduce((width, run) => width + run.font.widthOfTextAtSize(run.text, size), 0),
    heightAtSize: (size, options) => Math.max(...fonts.map(font => font.heightAtSize(size, options))) };
};

const getDominantSourceItem = (items, page) => {
  const families = new Map();
  for (const item of items) {
    const font = page.commonObjs.get(item.fontName), key = originalFontKey(font?.name || item.fontName);
    if (!families.has(key)) families.set(key, { characters: 0, width: 0, items: [] });
    const group = families.get(key);group.characters += [...item.str.replace(/\s/g, '')].length;group.width += Math.abs(item.width || 0);group.items.push(item);
  }
  const group = [...families.values()].sort((a, b) => b.characters - a.characters || b.width - a.width)[0];
  return group?.items.sort((a, b) => [...b.str.replace(/\s/g, '')].length - [...a.str.replace(/\s/g, '')].length || Math.abs(b.width) - Math.abs(a.width))[0] || items[0];
};

const originalFontKey = name => String(name || '').replace(/^[A-Z]{6}\+/, '').replace(/PS(?=MT|[-, ]?(?:Bold|Italic|Oblique))/ig, '').replace(/MT$/i, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

const findPreparedOriginalFont = (name, text = '') => {
  const key = originalFontKey(name);
  const aliases=importedFontFaces.get(name)?.aliases||[name];
  const weight=inferFontWeight(name,aliases.some(alias=>/bold|black|heavy/i.test(alias))?'bold':'normal'),italic=/italic|oblique/i.test(name)||aliases.some(alias=>/italic|oblique/i.test(alias));
  const direct = importedFontFaces.get(name);
  if (direct && (!text || fontCoversText(direct, text))) return direct;
  return [...importedFontFaces.values()].find(font => originalFontKey(font.name) === key && (!text || fontCoversText(font, text))) || direct;
};

const readOriginalFontFaces = bytes => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets = view.getUint32(0) === 0x74746366 ? Array.from({ length: view.getUint32(8) }, (_, i) => view.getUint32(12 + i * 4)) : [0];
  return offsets.map(offset => {
    const tables = new Map();for (let i = 0; i < view.getUint16(offset + 4); i++) { const at = offset + 12 + i * 16;tables.set(view.getUint32(at), bytes.slice(view.getUint32(at + 8), view.getUint32(at + 8) + view.getUint32(at + 12))); }
    if (!tables.has(0x676c7966)) throw new Error('请提供包含 TrueType 字形的 TTF/TTC 原字体');
    const name = tables.get(0x6e616d65), nv = new DataView(name.buffer, name.byteOffset, name.byteLength), aliases = [];let postScriptName='';
    for (let i = 0; i < nv.getUint16(2); i++) { const at = 6 + i * 12, platform = nv.getUint16(at), id = nv.getUint16(at + 6), length = nv.getUint16(at + 8), start = nv.getUint16(4) + nv.getUint16(at + 10);if (![1,4,6,16].includes(id)) continue;let value = '';if ([0,3].includes(platform)) for (let n = start; n < start + length; n += 2) value += String.fromCharCode(nv.getUint16(n));else for (const code of name.slice(start, start + length)) value += String.fromCharCode(code);if (value) aliases.push(value);if(id===6&&value)postScriptName=value; }
    return { data: rebuildTrueTypeFont(tables), aliases: [...new Set(aliases)], name: postScriptName || aliases[0] || 'OriginalFont' };
  });
};

const subsetOriginalFont = (data, text) => {
  const font=readTrueTypeFont(data), keep=new Set([0]);for(const char of text)keep.add(font.glyph(char.codePointAt(0)));
  const pending=[...keep];while(pending.length){const id=pending.pop(),bytes=font.bytes(id);if(bytes.length<10)continue;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.getInt16(0)>=0)continue;let at=10,flags;do{flags=view.getUint16(at);const component=view.getUint16(at+2);if(!keep.has(component)){keep.add(component);pending.push(component);}at+=4+(flags&1?4:2)+(flags&8?2:flags&64?4:flags&128?8:0);}while(flags&32);}
  const outlines=Array.from({length:font.count},(_,id)=>keep.has(id)?font.bytes(id):new Uint8Array()),glyf=new Uint8Array(outlines.reduce((n,bytes)=>n+((bytes.length+3)&~3),0)),loca=new Uint8Array((font.count+1)*4),view=new DataView(loca.buffer);let at=0;
  outlines.forEach((bytes,id)=>{view.setUint32(id*4,at);glyf.set(bytes,at);at+=(bytes.length+3)&~3;});view.setUint32(font.count*4,at);font.tables.set(0x676c7966,glyf);font.tables.set(0x6c6f6361,loca);const head=font.tables.get(0x68656164).slice();new DataView(head.buffer).setInt16(50,1);font.tables.set(0x68656164,head);return rebuildTrueTypeFont(font.tables);
};

const getPreparedOriginalVectorFont = (doc, cache, name, text) => {
  const prepared = findPreparedOriginalFont(name, text);
  if (!prepared?.data || !fontCoversText(prepared, text)) return null;
  const chars = [...new Set([...String(text).replace(/\n/g, '')])], key = `prepared-original:${prepared.loadedName}:${chars.join('')}`;if (cache.has(key)) return cache.get(key);
  let metrics;try { metrics = readTrueTypeFont(prepared.data); } catch { return null; }
  const { PDFName, PDFHexString } = PDFLib, ctx = doc.context, units = metrics.units, hhea = new DataView(metrics.tables.get(0x68686561).buffer), head = new DataView(metrics.tables.get(0x68656164).buffer);
  const ascent = hhea.getInt16(4) * 1000 / units, descent = hhea.getInt16(6) * 1000 / units, codes = new Map(chars.map((char, i) => [char, i + 1]));
  const programKey = `original-program:${prepared.loadedName}`;let program = cache.get(programKey);if (!program) { const data=subsetOriginalFont(prepared.data,(replacementSubsetCorpus?.text??[...app.importedTexts.values()].join(''))+text);program = ctx.register(ctx.flateStream(data, { Length1: data.length }));cache.set(programKey, program); }
  const baseName = String(prepared.postScriptName || name).replace(/^[A-Z]{6}\+/, '').replace(/\s/g, ''), gidMap = new Uint8Array((chars.length + 1) * 2), gids = new DataView(gidMap.buffer);
  chars.forEach((char, i) => gids.setUint16((i + 1) * 2, metrics.glyph(char.codePointAt(0))));
  const descriptor = ctx.register(ctx.obj({ Type:'FontDescriptor', FontName:baseName, Flags:4, FontBBox:[36,38,40,42].map(at=>head.getInt16(at)*1000/units), ItalicAngle:0, Ascent:ascent, Descent:descent, CapHeight:ascent, StemV:80, FontFile2:program }));
  const descendant = ctx.register(ctx.obj({ Type:'Font', Subtype:'CIDFontType2', BaseFont:baseName, CIDSystemInfo:{Registry:PDFLib.PDFString.of('Adobe'),Ordering:PDFLib.PDFString.of('Identity'),Supplement:0}, FontDescriptor:descriptor, DW:500, W:chars.flatMap((char,i)=>[i+1,[metrics.width(metrics.glyph(char.codePointAt(0)))*1000/units]]), CIDToGIDMap:ctx.register(ctx.flateStream(gidMap)) }));
  const hex = value => value.toString(16).padStart(4,'0'), utf16 = char => Array.from({length:char.length},(_,i)=>hex(char.charCodeAt(i))).join(''), groups=[];
  for(let at=0;at<chars.length;at+=100){const part=chars.slice(at,at+100);groups.push(`${part.length} beginbfchar\n${part.map((char,i)=>`<${hex(at+i+1)}> <${utf16(char)}>`).join('\n')}\nendbfchar`);}
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /OriginalFontUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${groups.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend end`;
  const ref = ctx.register(ctx.obj({Type:'Font',Subtype:'Type0',BaseFont:baseName,Encoding:'Identity-H',DescendantFonts:[descendant],ToUnicode:ctx.register(ctx.flateStream(app.pdfBinaryStringToBytes(cmap)))}));
  const font = { originalRef:ref, encodeText:value=>PDFHexString.of([...value].map(char=>{const code=codes.get(char);if(code==null)throw new Error('字体字符集合发生变化');return hex(code);}).join('')), widthOfTextAtSize:(value,size)=>[...value].reduce((sum,char)=>sum+metrics.width(metrics.glyph(char.codePointAt(0))),0)*size/units, heightAtSize:(size,options={})=>(ascent-(options.descender===false?0:descent))*size/1000 };
  // Use outline bounds for this text, rather than the font-wide line box.
  // A font's global ascender includes glyphs absent from the replacement.
  font.inkBoundsAtSize = (value, size) => {
    let ascent = 0, descent = 0;
    for (const character of value) {
      const bytes = metrics.bytes(metrics.glyph(character.codePointAt(0)));
      if (bytes.length < 10) continue;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      ascent = Math.max(ascent, view.getInt16(8) * size / units);
      descent = Math.max(descent, -view.getInt16(4) * size / units);
    }
    return {ascent, descent};
  };
  cache.set(key,font);return font;
};

const replacementFontMetrics = new WeakMap();

const measureReplacementText = (text, font, size, family = 'serif') => {
      if (font && !font.data && /^STSong-Light/i.test(font.name || '')) return [...text].reduce((width, character) => width + (character.codePointAt(0) >= 32 && character.codePointAt(0) <= 126 ? .5 : 1), 0) * size;
      if (font?.data && fontCoversText(font, text)) {
        try {
          if (!replacementFontMetrics.has(font)) replacementFontMetrics.set(font, readTrueTypeFont(font.data));
          const metrics = replacementFontMetrics.get(font);
          return [...text].reduce((width, character) => width + metrics.width(metrics.glyph(character.codePointAt(0))), 0) * size / metrics.units;
        } catch (error) { /* 非 TrueType 字体交给浏览器按原字体测量。 */
        }
      }
      const context = document.createElement('canvas').getContext?.('2d');
      if (!context) return [...text].length * size;
      context.font = `${size}px ${family}`;
      return context.measureText(text).width;
    };

const getStableImportedFontFamily = (originalText, originalFontFamily, originalFontName = '') => {
      const family = `${originalFontName} ${originalFontFamily || ''}`.toLowerCase();
      if (/malgun/.test(family)) return `"Malgun Gothic", "Microsoft YaHei", ${app.IMPORTED_LATIN_SANS_FONT_FAMILY}`;
      if (/yahei|pingfang|heiti|gothic/.test(family)) return `"Microsoft YaHei", "PingFang SC", ${app.IMPORTED_LATIN_SANS_FONT_FAMILY}`;
      if (/nsimsun|simsun|songti|stsong/.test(family)) {
        return app.IMPORTED_CJK_SERIF_FONT_FAMILY;
      }
      if (/dengxian|等线/.test(family)) return `\"DengXian\", \"等线\", ${app.IMPORTED_LATIN_SANS_FONT_FAMILY}`;
      if (/mono|courier/.test(family)) return app.IMPORTED_MONOSPACE_FONT_FAMILY;
      if (/sans|arial|helvetica|dejavu/.test(family)) return app.IMPORTED_LATIN_SANS_FONT_FAMILY;
      return app.IMPORTED_LATIN_SERIF_FONT_FAMILY;
    };

const ORIGINAL_SIMSUN_LATIN = app.fontPrograms.original.simSun;

const readTrueTypeFont = data => {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength), tables = new Map();
      for (let i = 0; i < view.getUint16(4); i++) {
        const at = 12 + i * 16, offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
        tables.set(view.getUint32(at), data.slice(offset, offset + length));
      }
      const table = tag => {
        const bytes = tables.get(tag);
        return bytes && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      };
      const head = table(0x68656164), cmap = table(0x636d6170), loca = table(0x6c6f6361), hhea = table(0x68686561),
        hmtx = table(0x686d7478);
      const unicode = [];
      for (let i = 0; i < cmap.getUint16(2); i++) {
        const at = 4 + i * 8, platform = cmap.getUint16(at), encoding = cmap.getUint16(at + 2);
        if (platform === 0 || platform === 3 && [1, 10].includes(encoding)) unicode.push(cmap.getUint32(at + 4));
      }
      const glyph = code => {
        for (const at of unicode) {
          const format = cmap.getUint16(at);
          if (format === 12) for (let i = 0; i < cmap.getUint32(at + 12); i++) {
            const group = at + 16 + i * 12;
            if (code >= cmap.getUint32(group) && code <= cmap.getUint32(group + 4)) return cmap.getUint32(group + 8) + code - cmap.getUint32(group);
          }
          if (format === 4 && code <= 65535) {
            const count = cmap.getUint16(at + 6) / 2, ends = at + 14, starts = ends + count * 2 + 2,
              deltas = starts + count * 2, ranges = deltas + count * 2;
            for (let i = 0; i < count; i++) {
              const start = cmap.getUint16(starts + i * 2), end = cmap.getUint16(ends + i * 2);
              if (code < start || code > end) continue;
              const delta = cmap.getInt16(deltas + i * 2), range = cmap.getUint16(ranges + i * 2);
              const gid = range ? cmap.getUint16(ranges + i * 2 + range + (code - start) * 2) : code;
              return range && !gid ? 0 : (gid + delta) & 65535;
            }
          }
        }
        return 0;
      };
      const offset = id => head.getInt16(50) ? loca.getUint32(id * 4) : loca.getUint16(id * 2) * 2;
      return {
        tables,
        units: head.getUint16(18),
        count: table(0x6d617870).getUint16(4),
        glyph,
        bytes: id => tables.get(0x676c7966).slice(offset(id), offset(id + 1)),
        width: id => hmtx.getUint16(Math.min(id, hhea.getUint16(34) - 1) * 4)
      };
    };

const rebuildTrueTypeFont = tables => {
      const entries = [...tables].sort(([a], [b]) => a - b), count = entries.length,
        padded = length => (length + 3) & ~3;
      const size = 12 + count * 16 + entries.reduce((sum, [, bytes]) => sum + padded(bytes.length), 0);
      const result = new Uint8Array(size), view = new DataView(result.buffer);
      view.setUint32(0, 0x00010000);
      view.setUint16(4, count);
      const power = 2 ** Math.floor(Math.log2(count));
      view.setUint16(6, power * 16);
      view.setUint16(8, Math.log2(power));
      view.setUint16(10, count * 16 - power * 16);
      let offset = 12 + count * 16, headOffset;
      const checksum = bytes => {
        let sum = 0;
        for (let i = 0; i < bytes.length; i += 4) sum = (sum + ((bytes[i] || 0) * 0x1000000 + (bytes[i + 1] || 0) * 0x10000 + (bytes[i + 2] || 0) * 0x100 + (bytes[i + 3] || 0))) >>> 0;
        return sum;
      };
      entries.forEach(([tag, bytes], i) => {
        bytes = bytes.slice();
        if (tag === 0x68656164) {
          new DataView(bytes.buffer).setUint32(8, 0);
          headOffset = offset;
        }
        result.set(bytes, offset);
        const at = 12 + i * 16;
        view.setUint32(at, tag);
        view.setUint32(at + 4, checksum(bytes));
        view.setUint32(at + 8, offset);
        view.setUint32(at + 12, bytes.length);
        offset += padded(bytes.length);
      });
      view.setUint32(headOffset + 8, (0xb1b0afba - checksum(result)) >>> 0);
      return result;
    };

// PDF 中的 TrueType 可以没有 Unicode cmap；浏览器直接加载它会回退到别的字体。
// 仅按原 PDF 的 ToUnicode 和 CIDToGIDMap 建立映射，不猜测缺失字形。
const makeUnicodeFontCmap = mappings => {
  const groups = [];
  for (const [code, glyph] of [...mappings].filter(([code,glyph])=>code>=0&&code<=0x10ffff&&glyph>0&&glyph<=65535).sort((a,b)=>a[0]-b[0])) {
    const previous=groups.at(-1);
    if(previous&&previous.end+1===code&&previous.glyph+code-previous.start===glyph)previous.end=code;
    else groups.push({start:code,end:code,glyph});
  }
  const bytes=new Uint8Array(36+groups.length*12),view=new DataView(bytes.buffer);
  view.setUint16(2,2);view.setUint16(4,0);view.setUint16(6,4);view.setUint32(8,20);
  view.setUint16(12,3);view.setUint16(14,10);view.setUint32(16,20);
  view.setUint16(20,12);view.setUint32(24,bytes.length-20);view.setUint32(32,groups.length);
  groups.forEach((group,index)=>{const at=36+index*12;view.setUint32(at,group.start);view.setUint32(at+4,group.end);view.setUint32(at+8,group.glyph);});
  return bytes;
};

const getUnicodeFontMappings = font => {
  const bytes=font.tables.get(0x636d6170),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),mappings=new Map();
  for(let i=0;i<view.getUint16(2);i++){
    const at=4+i*8,platform=view.getUint16(at),encoding=view.getUint16(at+2);
    if(platform!==0&&!(platform===3&&[1,10].includes(encoding)))continue;
    const table=view.getUint32(at+4),format=view.getUint16(table);
    if(format===12){for(let n=0;n<view.getUint32(table+12);n++){const group=table+16+n*12,start=view.getUint32(group),end=view.getUint32(group+4),first=view.getUint32(group+8);for(let code=start;code<=end&&code<=0x10ffff;code++)if(first+code-start)mappings.set(code,first+code-start);}}
    if(format===4){const count=view.getUint16(table+6)/2,ends=table+14,starts=ends+count*2+2;for(let n=0;n<count;n++)for(let code=view.getUint16(starts+n*2);code<=view.getUint16(ends+n*2)&&code<65535;code++){const glyph=font.glyph(code);if(glyph)mappings.set(code,glyph);}}
  }
  return mappings;
};

const prepareOriginalFontProgram = (data, name, dict, doc) => {
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength),tables=new Map();
  for(let i=0;i<view.getUint16(4);i++){const at=12+i*16,start=view.getUint32(at+8);tables.set(view.getUint32(at),data.slice(start,start+view.getUint32(at+12)));}
  if(!tables.has(0x676c7966))return data;
  const existingCmap=tables.get(0x636d6170);let unicodeCmap=false;
  if(existingCmap){const cmapView=new DataView(existingCmap.buffer,existingCmap.byteOffset,existingCmap.byteLength);for(let i=0;i<cmapView.getUint16(2);i++){const at=4+i*8,platform=cmapView.getUint16(at),encoding=cmapView.getUint16(at+2);if(platform===0||platform===3&&[1,10].includes(encoding))unicodeCmap=true;}}
  if(!unicodeCmap){
    const {PDFName}=PDFLib,context=doc.context,descendants=context.lookup(dict.get(PDFName.of('DescendantFonts'))),descendant=descendants&&context.lookup(descendants.get(0));
    const unicode=context.lookup(dict.get(PDFName.of('ToUnicode')));
    if(!descendant||!unicode||!['/Identity-H','/Identity-V'].includes(String(dict.get(PDFName.of('Encoding')))))return data;
    const map=context.lookup(descendant.get(PDFName.of('CIDToGIDMap'))),glyphBytes=map&&String(map)!=='/Identity'?PDFLib.decodePDFRawStream(map).decode():null;
    const glyphView=glyphBytes&&new DataView(glyphBytes.buffer,glyphBytes.byteOffset,glyphBytes.byteLength),mappings=new Map(),count=new DataView(tables.get(0x6d617870).buffer).getUint16(4);
    const add=(source,destination)=>{
      let text='';for(let i=0;i<destination.length;i+=4)text+=String.fromCharCode(parseInt(destination.slice(i,i+4),16));
      if([...text].length!==1)return;const cid=parseInt(source,16),glyph=glyphView?(cid*2+1<glyphBytes.length?glyphView.getUint16(cid*2):0):cid;
      if(glyph>0&&glyph<count)mappings.set(text.codePointAt(0),glyph);
    };
    const cmap=app.pdfBytesToBinaryString(PDFLib.decodePDFRawStream(unicode).decode());
    for(const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const entry of section[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi))add(entry[1],entry[2]);
    for(const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))for(const entry of section[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*(<([\da-f]+)>|\[([^\]]*)\])/gi)){
      const start=parseInt(entry[1],16),end=parseInt(entry[2],16);if(end-start>65535)continue;
      const values=entry[5]?[...entry[5].matchAll(/<([\da-f]+)>/gi)].map(match=>match[1]):null;
      for(let code=start;code<=end;code++){const target=values?values[code-start]:(parseInt(entry[4],16)+code-start).toString(16).padStart(entry[4].length,'0');if(target)add(code.toString(16),target);}
    }
    if(!mappings.size)return data;tables.set(0x636d6170,makeUnicodeFontCmap(mappings));
  }
  if(!tables.has(0x706f7374)){const post=new Uint8Array(32);new DataView(post.buffer).setUint32(0,0x00030000);tables.set(0x706f7374,post);}
  return rebuildTrueTypeFont(tables);
};

let originalLatinFont;

const completeOriginalFont = (data, name) => {
      if (!/(?:NSimSun|SimSun)/i.test(name)) return {data};
      try {
        const font = readTrueTypeFont(data);
        if (font.units !== ORIGINAL_SIMSUN_LATIN.units) return {data};
        originalLatinFont ||= readTrueTypeFont(app.dataUrlToUint8Array(`data:font/ttf;base64,${ORIGINAL_SIMSUN_LATIN.data}`));
        const outlines = Array.from({length: font.count}, (_, id) => font.bytes(id)), extraGlyphs = [],mappings=getUnicodeFontMappings(font),widths=Array.from({length:font.count},(_,id)=>font.width(id));
        const hhea=new DataView(font.tables.get(0x68686561).buffer),hmtx=new DataView(font.tables.get(0x686d7478).buffer),metricCount=hhea.getUint16(34);
        const bearings=Array.from({length:font.count},(_,id)=>hmtx.getInt16(id<metricCount?id*4+2:metricCount*4+(id-metricCount)*2));
        for (const [code, metric] of Object.entries(ORIGINAL_SIMSUN_LATIN.glyphs)) {
          let id = font.glyph(Number(code));const shape=originalLatinFont.bytes(metric.id);
          if(!id){
            if(outlines.length>=65535||shape.length&&new DataView(shape.buffer,shape.byteOffset).getInt16(0)<0)continue;
            id=outlines.length;outlines.push(shape);widths.push(metric.width);bearings.push(shape.length?new DataView(shape.buffer,shape.byteOffset).getInt16(2):0);mappings.set(Number(code),id);
          }else if(shape.length&&new DataView(shape.buffer,shape.byteOffset).getInt16(0)>=0&&(!outlines[id].length||!new DataView(outlines[id].buffer,outlines[id].byteOffset).getInt16(0)))outlines[id]=shape;
          if(Number(code)===32||outlines[id].length&&new DataView(outlines[id].buffer,outlines[id].byteOffset).getInt16(0))extraGlyphs.push({char:String.fromCodePoint(Number(code)),id,width:widths[id]*1000/font.units});
        }
        const expandedMetrics=new Uint8Array(outlines.length*4),expandedView=new DataView(expandedMetrics.buffer);
        widths.forEach((width,id)=>{expandedView.setUint16(id*4,width);expandedView.setInt16(id*4+2,bearings[id]);});
        font.tables.set(0x686d7478,expandedMetrics);hhea.setUint16(34,outlines.length);
        new DataView(font.tables.get(0x6d617870).buffer).setUint16(4,outlines.length);
        font.tables.set(0x636d6170,makeUnicodeFontCmap(mappings));
        const length = outlines.reduce((sum, bytes) => sum + ((bytes.length + 3) & ~3), 0),
          glyf = new Uint8Array(length), loca = new Uint8Array((outlines.length + 1) * 4),
          positions = new DataView(loca.buffer);
        let offset = 0;
        outlines.forEach((bytes, id) => {
          positions.setUint32(id * 4, offset);
          glyf.set(bytes, offset);
          offset += (bytes.length + 3) & ~3;
        });
        positions.setUint32(outlines.length * 4, offset);
        font.tables.set(0x676c7966, glyf);
        font.tables.set(0x6c6f6361, loca);
        new DataView(font.tables.get(0x68656164).buffer).setInt16(50, 1);
        if (!font.tables.has(0x6e616d65)) font.tables.set(0x6e616d65, originalLatinFont.tables.get(0x6e616d65));
        // PDF 字体子集可以省略 post，浏览器的 OpenType 校验需要该表。
        if (!font.tables.has(0x706f7374)) {
          const post = new Uint8Array(32);
          new DataView(post.buffer).setUint32(0, 0x00030000);
          font.tables.set(0x706f7374, post);
        }
        return {data: rebuildTrueTypeFont(font.tables), extraGlyphs};
      } catch {
        return {data};
      }
    };

const fontCoverageCache = new WeakMap();

const importedFontFaces = new Map();

const originalPdfFontObjects = new Map();

let importedFontPreparation = null;

const prepareImportedFonts = () => {
      if (importedFontPreparation) return importedFontPreparation;
      const sourceDoc = app.pdfDoc;
      importedFontPreparation = (async () => {
        if (!sourceDoc) return;
        await app.ensureFontPrograms();
        if (app.pdfDoc !== sourceDoc) return;
        const doc = await PDFLib.PDFDocument.load(app.pdfBuffer || await sourceDoc.getData());
        const {PDFName} = PDFLib;
        if (!importedFontFaces.has('complete-simsun-latin')) {
          const data = app.dataUrlToUint8Array(`data:font/ttf;base64,${ORIGINAL_SIMSUN_LATIN.data}`), font = { name: 'complete-simsun-latin', data, loadedName: '' };
          importedFontFaces.set(font.name, font);
          try { const face = await new FontFace('original-simsun-latin', data).load();document.fonts.add(face);Object.assign(font, { loadedName: 'original-simsun-latin', face }); } catch { /* 浏览器不接受该字体时使用同系列完整字体。 */ }
        }
        for (const [, dict] of doc.context.enumerateIndirectObjects()) {
          if (app.pdfDoc !== sourceDoc) return;
          if (typeof dict.get !== 'function' || String(dict.get(PDFName.of('Type'))) !== '/Font' || /^\/CIDFontType[02]$/.test(String(dict.get(PDFName.of('Subtype'))))) continue;
          const name = dict.get(PDFName.of('BaseFont'))?.decodeText?.();
          if (!name || importedFontFaces.has(name)) continue;
          const descendants = doc.context.lookup(dict.get(PDFName.of('DescendantFonts')));
          const fontDict = descendants ? doc.context.lookup(descendants.get(0)) : dict;
          const descriptor = doc.context.lookup(fontDict.get(PDFName.of('FontDescriptor')));
          if (!descriptor) continue;
          const file = descriptor.get(PDFName.of('FontFile2')) || descriptor.get(PDFName.of('FontFile3'));
          if (!file) continue;
          try {
            const raw=PDFLib.decodePDFRawStream(doc.context.lookup(file)).decode();
            const completed = completeOriginalFont(prepareOriginalFontProgram(raw, name, dict, doc), name);
            const data = completed.data;
            const loadedName = `original-edit-${++originalFontSequence}`;
            let aliases=[name];try{aliases.push(...readOriginalFontFaces(data)[0].aliases);}catch{}
            const prepared = {name, data, aliases:[...new Set(aliases)], loadedName: '', extraGlyphs: completed.extraGlyphs};
            // PDF 导出不依赖浏览器是否接受 FontFace，保留原字体程序和补齐的字形。
            importedFontFaces.set(name, prepared);
            const face = await new FontFace(loadedName, data, { weight: inferFontWeight(name, 'normal'), style: /italic|oblique/i.test(name) ? 'italic' : 'normal' }).load();
            if (app.pdfDoc !== sourceDoc) return;
            document.fonts.add(face);
            Object.assign(prepared, {loadedName, face});
          } catch (err) {
            console.warn('原字体程序无法用于浏览器，使用同系列完整字体:', name, err);
          }
        }
        await prepareAutomaticFonts();await prepareReplacementPolicyFonts();
      })().catch(async err => {console.warn('读取原嵌入字体失败，自动补足:', err);await prepareAutomaticFonts();await prepareReplacementPolicyFonts();}).catch(error => {
        if (app.pdfDoc === sourceDoc) importedFontPreparation = null;
        throw error;
      });
      return importedFontPreparation;
    };

const fontCoversText = (font, text) => {
      if (!font?.data) return false;
      let covers = fontCoverageCache.get(font);
      if (!covers) {
        try {
          const bytes = font.data, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
            tables = new Map();
          for (let i = 0; i < view.getUint16(4); i++) {
            const record = 12 + i * 16;
            tables.set(view.getUint32(record), view.getUint32(record + 8));
          }
          const cmap = tables.get(0x636d6170), glyf = tables.get(0x676c7966), loca = tables.get(0x6c6f6361),
            head = tables.get(0x68656164);
          if (!cmap) return false;
          const unicodeTables = [];
          for (let i = 0; i < view.getUint16(cmap + 2); i++) {
            const record = cmap + 4 + i * 8, platform = view.getUint16(record), encoding = view.getUint16(record + 2);
            if (platform === 0 || platform === 3 && [1, 10].includes(encoding)) unicodeTables.push(cmap + view.getUint32(record + 4));
          }
          const glyphExists = glyph => {
            if (!glyph) return false;
            if (!glyf || !loca || !head) return true;
            const long = view.getInt16(head + 50) === 1;
            const at = loca + glyph * (long ? 4 : 2);
            return long ? view.getUint32(at + 4) > view.getUint32(at) : view.getUint16(at + 2) > view.getUint16(at);
          };
          covers = code => unicodeTables.some(table => {
            const format = view.getUint16(table);
            if (format === 12) {
              for (let i = 0; i < view.getUint32(table + 12); i++) {
                const group = table + 16 + i * 12;
                if (code >= view.getUint32(group) && code <= view.getUint32(group + 4)) return glyphExists(view.getUint32(group + 8) + code - view.getUint32(group));
              }
            } else if (format === 4 && code <= 65535) {
              const count = view.getUint16(table + 6) / 2, ends = table + 14, starts = ends + count * 2 + 2,
                deltas = starts + count * 2, ranges = deltas + count * 2;
              for (let i = 0; i < count; i++) {
                if (code < view.getUint16(starts + i * 2) || code > view.getUint16(ends + i * 2)) continue;
                const delta = view.getInt16(deltas + i * 2), range = view.getUint16(ranges + i * 2);
                const glyph = range ? view.getUint16(ranges + i * 2 + range + (code - view.getUint16(starts + i * 2)) * 2) : code;
                return glyphExists(range && !glyph ? 0 : (glyph + delta) & 65535);
              }
            }
            return false;
          });
          fontCoverageCache.set(font, covers);
        } catch {
          return false;
        }
      }
      return Array.from(String(text)).every(char => /\s/.test(char) || covers(char.codePointAt(0)));
    };

const getLoadedPdfFont = (pageNum, fontName) => {
      let font = originalPdfFontObjects.get(fontName);
      try {
        const objects = app.pdfViewer?.getPageView(pageNum - 1)?.pdfPage?.commonObjs;
        if (objects?.has(fontName)) {
          font = objects.get(fontName);
          originalPdfFontObjects.set(fontName, font);
        }
      } catch { /* 不可见页面的视图可被释放，字体信息仍保存在缓存中。 */
      }
      return importedFontFaces.get(font?.name) || font;
    };

let replacementMetricDocument = null;

let originalFontSequence = 0;

const replacementMetricFonts = new Map();

const getPreviewBaselineOffset = (family, size, leading, text, weight = 'normal') => {
      const context = document.createElement('canvas').getContext?.('2d');if (!context) return size * .8;
      context.font = `${weight} ${size}px ${family}`;
      const metrics = context.measureText(String(text).replace(/\n/g, '').slice(0, 256));
      const ascent = metrics.fontBoundingBoxAscent, descent = metrics.fontBoundingBoxDescent;
      return Number.isFinite(ascent) && Number.isFinite(descent) ? (leading - ascent - descent) / 2 + ascent : size * .8;
    };

const getReplacementMetrics = async (pageNum, text, fontFamily, fontName, weight = 'normal', style = 'normal') => {
      replacementMetricDocument ||= { promise: app.loadEditablePdf(), fonts: new Map() };
      const entry = replacementMetricDocument, doc = await entry.promise;
      try { return await app.getPdfVectorFont(doc, entry.fonts, fontFamily, weight, style, { page: doc.getPages()[pageNum - 1], originalFontName: fontName, text }); }
      catch { const context = document.createElement('canvas').getContext?.('2d');return { measureOnly:true, widthOfTextAtSize:(value,size)=>{ if(!context)return [...value].length*size;context.font=`normal 400 ${size}px ${fontFamily}`;return context.measureText(value).width; },heightAtSize:size=>size,encodeText:()=>PDFLib.PDFHexString.of('') }; }
    };

const getReplacementSourceFont = (text, font) => font;

const getReplacementFontFamily = (text, originalFamily, originalName, font, weight = 'normal') => {
      // Han glyphs use Song; every other character uses New Song.
      if(String(text??''))return getPolicyCssFamily();
      const name = originalName || font?.name || '', direct = findPreparedOriginalFont(name, text), prepared = !text || fontCoversText(direct, text) ? direct : getAutomaticFont(name, text, weight) || direct;
      const declared = name.replace(/^[A-Z]{6}\+/, ''), base=/^CIDFont|^Font\d/i.test(declared)?(prepared?.aliases?.find(alias=>!/^CIDFont/i.test(alias))||declared):declared;
      const family = /timesnewroman/i.test(base) ? 'Times New Roman' : /couriernew/i.test(base) ? 'Courier New' : /arial/i.test(base) ? 'Arial' : /stsong/i.test(base) ? 'SimSun' : base.replace(/[-,](?:Regular|Bold|Italic|Oblique|Light).*$/i, '');
      const source = originalFamily || 'serif';
      if (prepared?.loadedName && fontCoversText(prepared, text)) return `"${prepared.loadedName}", "${family.replace(/"/g, '')}", ${source}`;
      if (font?.loadedName && fontCoversText(font, text)) return `"${font.loadedName}", "${family}", ${source}`;
      return family ? `"${family.replace(/"/g, '')}", ${source}` : source;
    };

const unquoteFontFamily = family => (family || '').trim().replace(/^['"]|['"]$/g, '');

const quoteFontFamily = family => {
      const value = (family || '').trim();
      if (!value) return '';
      if (value.indexOf(',') >= 0 || /^['"].*['"]$/.test(value)) return value;
      return /[\s()]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
    };

const isGenericFontFamily = family => {
      const value = unquoteFontFamily((family || '').split(',')[0]).toLowerCase();
      return value === 'serif' || value === 'sans-serif' || value === 'monospace' || value === 'cursive' || value === 'fantasy' || value === 'system-ui';
    };

const findFontFaceFamily = candidate => {
      const target = unquoteFontFamily(candidate);
      if (!target) return '';
      if (fontFaceFamilyCache.has(target)) return fontFaceFamilyCache.get(target);
      for (const _sheet of document.styleSheets) {
        let rules;
        try {
          rules = _sheet.cssRules;
        } catch (e) {
          continue;
        }
        if (!rules) continue;
        for (const rule of rules) {
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            const family = rule.style.getPropertyValue('font-family');
            if (unquoteFontFamily(family) === target) {
              const resolvedFamily = quoteFontFamily(family);
              fontFaceFamilyCache.set(target, resolvedFamily);
              return resolvedFamily;
            }
          }
        }
      }
      return '';
    };

const inferFontWeight = (fontName, computedWeight) => {
      const name=/^(?:CIDFont|Font\d)/i.test(fontName||'')?[fontName,...(importedFontFaces.get(fontName)?.aliases||[])].join(' '):fontName;
      if (/bold|black|heavy|semibold|demibold/i.test(name || '')) return '700';
      return computedWeight || 'normal';
    };

const resolveOriginalSpanFontInfo = async (pageNum, span, spanIndex, text = span.textContent, sourceSpans = [], prepareFontFaces = true) => {
      // 原文只加合并框时直接使用已经绘制本页的字体，避免后台等待额外的 FontFace 加载。
      // JSON 替换和确实需要重绘的文字仍按原路径准备嵌入字体。
      if (prepareFontFaces) await prepareImportedFonts();
      const computedStyle = getComputedStyle(span);
      const textContent = await app.getPageTextContent(pageNum);
      const item = app.findTextContentItemForSpan(textContent, span, spanIndex, pageNum);
      const pdfStyle = item && textContent && textContent.styles ? textContent.styles[item.fontName] : null;
      const sourcePage = item?.fontName && await app.pdfDoc.getPage(pageNum);
      if (sourcePage?.commonObjs && !sourcePage.commonObjs.has(item.fontName)) await sourcePage.getOperatorList();
      if (sourcePage?.commonObjs?.has(item?.fontName)) originalPdfFontObjects.set(item.fontName, sourcePage.commonObjs.get(item.fontName));
      const fontObject = getLoadedPdfFont(pageNum, item?.fontName);
      const originalFontName = fontObject?.name || span.dataset.pdfOriginalFontName || '';
      const candidates = [];
      if (pdfStyle && pdfStyle.fontFamily) candidates.push(pdfStyle.fontFamily);
      if (item && item.fontName) candidates.push(item.fontName);
      if (span.style.fontFamily) candidates.push(span.style.fontFamily);
      if (computedStyle.fontFamily) candidates.push(computedStyle.fontFamily);
      // 同一段中可能混用字体（例如页头的 ⁴ 使用另一套嵌入字形）。
      // 将原字体按源文本顺序依次列入 CSS 回退链，缺字时由下一套原字体补齐。
      const sourceFonts = [];
      const firstFontCoversText = fontCoversText(fontObject, text);
      if (!firstFontCoversText && sourceSpans.length) for (const sourceSpan of [span, ...sourceSpans.map(item => item.span)]) {
        const sourceItem = app.findTextContentItemForSpan(textContent, sourceSpan, app.getSpanIndex(sourceSpan), pageNum);
        const sourceFont = getLoadedPdfFont(pageNum, sourceSpan.dataset.pdfFontName || sourceItem?.fontName);
        if (sourceFont?.data && !sourceFonts.some(font => font.loadedName === sourceFont.loadedName)) sourceFonts.push(sourceFont);
      }
      // 未嵌入字体沿用 PDF.js 绘制原页时的字体族，避免合并后换成另一种宋体。
      const fallbackFamily = fontObject?.missingFile ? quoteFontFamily(pdfStyle?.fontFamily || fontObject.fallbackName || 'serif') : originalFontName ? getStableImportedFontFamily(text, pdfStyle?.fontFamily, originalFontName) : '';
      let fontFamily = sourceFonts.length > 1
        ? `${sourceFonts.map(font => `"${font.loadedName}"`).join(', ')}, ${fallbackFamily || 'serif'}`
        : firstFontCoversText ? `"${fontObject.loadedName}"` : fallbackFamily;
      for (const candidate of candidates) {
        if (fontFamily) break;
        const fontFaceFamily = findFontFaceFamily(candidate);
        // 未嵌入字体的 PDF 内部编号不是可用的 CSS 字体，必须沿用文字层字体。
        if (!fontFaceFamily && /^g_d\d+_f\d+$/i.test(candidate)) continue;
        const resolved = fontFaceFamily || quoteFontFamily(candidate);
        if (resolved && !isGenericFontFamily(resolved)) {
          fontFamily = resolved;
          break;
        }
      }
      if (!fontFamily) {
        fontFamily = quoteFontFamily(span.style.fontFamily || computedStyle.fontFamily || 'serif');
      }
      return {
        fontFamily,
        fontWeight: span.style.fontWeight || computedStyle.fontWeight,
        fontName: item?.fontName || '',
        originalFontName,
        pdfStyle: pdfStyle || null
      };
    };

const getPdfStandardFontName = (fontFamily, fontWeight, fontStyle) => {
      const family = String(fontFamily || '').toLowerCase();
      const weight = String(fontWeight || '').toLowerCase();
      const style = String(fontStyle || '').toLowerCase();
      const isBold = /bold|black|heavy|[7-9]00/.test(weight);
      const isItalic = /italic|oblique/.test(style);
      const isMono = /monospace|courier|liberation mono/.test(family);
      const isSans = /sans|arial|helvetica|dejavu|yahei|pingfang|malgun|gothic|heiti/.test(family);
      const base = isMono ? 'Courier' : isSans ? 'Helvetica' : 'TimesRoman';
      const italic = isItalic ? (isMono || isSans ? 'Oblique' : 'Italic') : '';
      return PDFLib.StandardFonts[`${base}${isBold ? 'Bold' : ''}${italic}`];
    };

const getOriginalPdfFont = (pdfLibDoc, page, fontCache, originalFontName, text, sourceRef = null) => {
      if (!page || !originalFontName) return null;
      const { PDFName, PDFHexString } = PDFLib;
      const context = pdfLibDoc.context;
      const fonts = context.lookup(page.node.Resources()?.get(PDFName.of('Font')));
      const normalizeName = name => String(name?.decodeText?.() || name || '').replace(/^\//, '').replace(/^[A-Z]{6}\+/, '');
      const exactName = name => String(name?.decodeText?.() || name || '').replace(/^\//, '');
      // 同一字体族可有多个编码、字宽完全不同的子集，不能仅凭去掉前缀后的名称混用。
      const entries = [...(fonts?.entries?.() || [])].sort((a,b) =>
        Number(exactName(context.lookup(b[1])?.get?.(PDFName.of('BaseFont'))) === exactName(originalFontName)) -
        Number(exactName(context.lookup(a[1])?.get?.(PDFName.of('BaseFont'))) === exactName(originalFontName)));
      for (const [key, ref] of entries) {
        if (sourceRef && String(ref) !== String(sourceRef)) continue;
        const dict = context.lookup(ref);
        if (typeof dict?.get !== 'function') continue;
        if (normalizeName(dict.get(PDFName.of('BaseFont'))) !== normalizeName(originalFontName)) continue;
        const cacheKey = `original:${ref}`;
        let font = fontCache.get(cacheKey);
        if (font && text && !canEncodePdfVectorText(font, text) && app.fontCoversText(app.importedFontFaces.get(originalFontName), text)) font = null;
        if (!font) {
          if (String(dict.get(PDFName.of('Encoding'))) === '/UniGB-UCS2-H') {
            const descendant = context.lookup(context.lookup(dict.get(PDFName.of('DescendantFonts')))?.get(0));
            const descriptor = context.lookup(descendant?.get(PDFName.of('FontDescriptor')));
            const ascent = context.lookup(descriptor?.get(PDFName.of('Ascent')))?.asNumber?.() ?? 880, descent = context.lookup(descriptor?.get(PDFName.of('Descent')))?.asNumber?.() ?? -120;
            const advance = character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) <= 126 ? 500 : 1000;
            font = { originalRef: ref, codeBytes: 2, encodeText: value => PDFHexString.of([...value].map(character => {
                if (character.codePointAt(0) > 65535) throw new Error('原字体的 UCS2 编码不支持该字符');
                return character.charCodeAt(0).toString(16).padStart(4, '0');
              }).join('')),
              widthOfTextAtSize: (value, size) => [...value].reduce((sum, character) => sum + advance(character), 0) * size / 1000,
              heightAtSize: (size, options = {}) => (ascent - (options.descender === false ? 0 : descent)) * size / 1000,
              measureOperands: (operands, size, spacing = 0, wordSpacing = 0) => {
                let width = 0, leadingWidth = 0, leading = true;
                for (const operand of operands) {
                  if (operand.type === 'number') { width -= operand.number * size / 1000;continue; }
                  if (operand.type !== 'string') continue;
                  const bytes = app.decodePdfStringBytes(operand.value);
                  for (let i = 0; i + 1 < bytes.length; i += 2) {
                    const character = String.fromCharCode(bytes[i] * 256 + bytes[i + 1]), step = advance(character) * size / 1000 + spacing + (character === ' ' ? wordSpacing : 0);
                    width += step;if (leading && !character.trim()) leadingWidth += step;else leading = false;
                  }
                }
                return { width, leadingWidth };
              } };
            fontCache.set(cacheKey, font);
            if (canEncodePdfVectorText(font, text)) return font;
            continue;
          }
          if (String(dict.get(PDFName.of('Encoding'))) === '/WinAnsiEncoding') {
            let widths = context.lookup(dict.get(PDFName.of('Widths'))), first = context.lookup(dict.get(PDFName.of('FirstChar')))?.asNumber?.() || 0;
            const descriptor = context.lookup(dict.get(PDFName.of('FontDescriptor')));
            const ascent = context.lookup(descriptor?.get(PDFName.of('Ascent')))?.asNumber?.() ?? 800, descent = context.lookup(descriptor?.get(PDFName.of('Descent')))?.asNumber?.() ?? -200;
            const extra = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
            if (!descriptor?.get(PDFName.of('FontFile')) && !descriptor?.get(PDFName.of('FontFile2')) && !descriptor?.get(PDFName.of('FontFile3'))) {
              const standard=Object.values(PDFLib.StandardFonts).includes(originalFontName)?PDFLib.StandardFontEmbedder.for(originalFontName):null;
              const canvas = standard?null:document.createElement('canvas').getContext?.('2d'), family = app.getReplacementFontFamily('', 'serif', originalFontName, null);
              if (standard||canvas) { if(canvas)canvas.font = `${app.inferFontWeight(originalFontName,'normal')} 1000px ${family}`;const oldWidths=widths,oldFirst=first;const values=Array.from({length:256},(_,code)=>{const width=code>=oldFirst&&code-oldFirst<(oldWidths?.size?.()||0)?oldWidths.lookup(code-oldFirst).asNumber():0;const char=code>=128&&code<160?extra[code-128]:String.fromCharCode(code);return width>0?width:code<32||code===127?0:standard?(standard.encoding.canEncodeUnicodeCodePoint(char.codePointAt(0))?standard.widthOfTextAtSize(char,1000):0):canvas.measureText(char).width;});widths=context.obj(values);first=0;dict.set(PDFName.of('Widths'),widths);dict.set(PDFName.of('FirstChar'),context.obj(0));dict.set(PDFName.of('LastChar'),context.obj(255)); }
            }

            const character = code => code >= 128 && code < 160 ? extra[code - 128] : String.fromCharCode(code);
            const codes = new Map(Array.from({ length: 256 }, (_, code) => [character(code), code]));
            const advance = code => code >= first && code - first < (widths?.size?.() || 0) ? widths.lookup(code - first).asNumber() : 500;
            font = {
              originalRef: ref,
              codeBytes: 1,
              encodeText: value => { const prepared = app.importedFontFaces.get(originalFontName);if (value && prepared?.data && !app.fontCoversText(prepared, value)) throw new Error('原西文字体子集缺少替换字形');return PDFHexString.of([...value].map(char => { const code = codes.get(char);if (code == null || widths && (code < first || code - first >= widths.size() || advance(code) <= 0)) throw new Error('原西文字体不支持该字符');return code.toString(16).padStart(2, '0'); }).join('')); },
              widthOfTextAtSize: (value, size) => [...value].reduce((sum, char) => sum + advance(codes.get(char)), 0) * size / 1000,
              heightAtSize: (size, options = {}) => (ascent - (options.descender === false ? 0 : descent)) * size / 1000,
              measureOperands: (operands, size, spacing = 0, wordSpacing = 0) => {
                let width = 0, leadingWidth = 0, leading = true;
                for (const operand of operands) {
                  if (operand.type === 'number') { const step = -operand.number * size / 1000;width += step;if (leading) leadingWidth += step;continue; }
                  if (operand.type !== 'string') continue;
                  for (const code of app.decodePdfStringBytes(operand.value)) {
                    const step = advance(code) * size / 1000 + spacing + (code === 32 ? wordSpacing : 0);
                    width += step;if (leading && code === 32) leadingWidth += step;else leading = false;
                  }
                }
                return { width, leadingWidth };
              }
            };
            fontCache.set(cacheKey, font);
            if (canEncodePdfVectorText(font, text)) return font;
            continue;
          }
          if (String(dict.get(PDFName.of('Encoding'))) !== '/Identity-H') continue;
          const unicodeStream = context.lookup(dict.get(PDFName.of('ToUnicode')));
          if (!unicodeStream) continue;
          const cmap = app.pdfBytesToBinaryString(PDFLib.decodePDFRawStream(unicodeStream).decode());
          const codes = new Map();
          const unicode = hex => {
            let value = '';
            for (let i = 0; i < hex.length; i += 4) value += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
            return value;
          };
          for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
            for (const entry of section[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi)) codes.set(unicode(entry[2]), entry[1]);
          }
          for (const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
            for (const entry of section[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*(<([\da-f]+)>|\[([^\]]*)\])/gi)) {
              const start = parseInt(entry[1], 16), end = parseInt(entry[2], 16);
              if (end - start > 65535) continue;
              const values = entry[5] ? [...entry[5].matchAll(/<([\da-f]+)>/gi)].map(match => match[1]) : null;
              for (let cid = start; cid <= end; cid++) {
                const hex = values ? values[cid - start] : (parseInt(entry[4], 16) + cid - start).toString(16).padStart(entry[4].length, '0');
                if (hex) codes.set(unicode(hex), cid.toString(16).padStart(entry[1].length, '0'));
              }
            }
          }
          const descendant = context.lookup(context.lookup(dict.get(PDFName.of('DescendantFonts')))?.get(0));
          if (!descendant) continue;
          const widths = new Map();
          const widthArray = context.lookup(descendant.get(PDFName.of('W')));
          const defaultWidth = context.lookup(descendant.get(PDFName.of('DW')))?.asNumber?.() ?? 1000;
          for (let i = 0; i < (widthArray?.size?.() || 0);) {
            const first = widthArray.lookup(i++).asNumber();
            const next = widthArray.lookup(i++);
            if (typeof next.size === 'function') {
              for (let j = 0; j < next.size(); j++) widths.set(first + j, next.lookup(j).asNumber());
            } else {
              const last = next.asNumber(), width = widthArray.lookup(i++).asNumber();
              for (let cid = first; cid <= last && cid - first <= 65535; cid++) widths.set(cid, width);
            }
          }
          const descriptor = context.lookup(descendant.get(PDFName.of('FontDescriptor')));
          const prepared = app.importedFontFaces.get(originalFontName);
          if (prepared?.extraGlyphs && String(descendant.get(PDFName.of('CIDToGIDMap'))) === '/Identity') {
            const added = prepared.extraGlyphs.filter(glyph => !codes.has(glyph.char));
            if (added.length) {
              const fontFile = descriptor.get(PDFName.of('FontFile2'));
              if (fontFile) {
                // CID与WinAnsi字体可能共用同一FontFile2。补齐CID字形时必须分离
                // 描述符和字体程序，否则原单字节字体的cmap被覆盖，PDF.js会绘制空字形。
                const expandedDescriptor = descriptor.clone(context);
                expandedDescriptor.set(PDFName.of('FontFile2'), context.register(context.flateStream(prepared.data, { Length1: prepared.data.length })));
                descendant.set(PDFName.of('FontDescriptor'), context.register(expandedDescriptor));
                const array = widthArray || context.obj([]);
                for (const glyph of added) {
                  codes.set(glyph.char, glyph.id.toString(16).padStart(4, '0'));widths.set(glyph.id, glyph.width);
                  array.push(PDFLib.PDFNumber.of(glyph.id));array.push(context.obj([glyph.width]));
                }
                descendant.set(PDFName.of('W'), array);
                const mapping = `${added.length} beginbfchar\n${added.map(glyph => `<${glyph.id.toString(16).padStart(4, '0')}> <${glyph.char.charCodeAt(0).toString(16).padStart(4, '0')}>`).join('\n')}\nendbfchar\n`;
                context.assign(dict.get(PDFName.of('ToUnicode')), context.flateStream(app.pdfBinaryStringToBytes(cmap.replace('endcmap', mapping + 'endcmap'))));
              }
            }
          }
                    // 扩展现有 CID 映射：只使用原字体程序中实际存在的字形，保留所有原编码。
          const preparedFont = app.importedFontFaces.get(originalFontName);
          if (preparedFont?.data && text && app.fontCoversText(preparedFont, text)) {
            try {
              const metrics = app.readTrueTypeFont(preparedFont.data), cidMapRef = descendant.get(PDFName.of('CIDToGIDMap'));
              const identity = !cidMapRef || String(cidMapRef) === '/Identity';
              const mapBytes = identity ? null : PDFLib.decodePDFRawStream(context.lookup(cidMapRef)).decode();
              const used = new Set([...codes.values()].map(code => parseInt(code, 16))), added = [];
              let nextCid = Math.max(0, ...used) + 1;
              for (const character of new Set(text.replace(/\n/g, ''))) {
                if (codes.has(character)) continue;
                const gid = metrics.glyph(character.codePointAt(0));
                if (!gid || nextCid > 65535) continue;
                let cid = identity && !used.has(gid) ? gid : nextCid++;
                while (used.has(cid) && nextCid <= 65535) cid = nextCid++;
                if (cid > 65535) continue;
                used.add(cid);codes.set(character, cid.toString(16).padStart(4, '0'));
                const width = metrics.width(gid) * 1000 / metrics.units; widths.set(cid, width);
                added.push({ cid, gid, character, width });
              }
              if (added.length) {
                const array = widthArray || context.obj([]);
                for (const glyph of added) { array.push(PDFLib.PDFNumber.of(glyph.cid));array.push(context.obj([glyph.width])); }
                descendant.set(PDFName.of('W'), array);
                if (!identity || added.some(glyph => glyph.cid !== glyph.gid)) {
                  const count = Math.max(mapBytes?.length / 2 || 0, ...used) + 1, mapping = new Uint8Array(count * 2), view = new DataView(mapping.buffer);
                  if (identity) for (let cid = 0; cid < count; cid++) view.setUint16(cid * 2, cid);else mapping.set(mapBytes);
                  for (const glyph of added) view.setUint16(glyph.cid * 2, glyph.gid);
                  descendant.set(PDFName.of('CIDToGIDMap'), context.register(context.flateStream(mapping)));
                }
                const unicodeHex = text => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16).padStart(4, '0')).join('');
                const mapping = `${added.length} beginbfchar\n${added.map(glyph => `<${glyph.cid.toString(16).padStart(4, '0')}> <${unicodeHex(glyph.character)}>`).join('\n')}\nendbfchar\n`;
                context.assign(dict.get(PDFName.of('ToUnicode')), context.flateStream(app.pdfBinaryStringToBytes(cmap.replace('endcmap', mapping + 'endcmap'))));
              }
            } catch { /* CFF、无 cmap 或无可用原字形时，维持同系列字体回退。 */ }
          }

          const unicodeByCode = new Map([...codes].map(([value, code]) => [parseInt(code, 16), value]));
          const ascent = context.lookup(descriptor?.get(PDFName.of('Ascent')))?.asNumber?.() ?? 800;
          const descent = context.lookup(descriptor?.get(PDFName.of('Descent')))?.asNumber?.() ?? -200;
          font = {
            originalRef: ref,
            codeBytes: 2,
            measureOperands: (operands, size, charSpacing = 0, wordSpacing = 0) => {
              let width = 0, leadingWidth = 0, leading = true;
              for (const operand of operands) {
                if (operand.type === 'number') { width -= operand.number * size / 1000; continue; }
                if (operand.type !== 'string') continue;
                const bytes = app.decodePdfStringBytes(operand.value);
                for (let i = 0; i + 1 < bytes.length; i += 2) {
                  const cid = bytes[i] * 256 + bytes[i + 1], value = unicodeByCode.get(cid);
                  const advance = (widths.get(cid) ?? defaultWidth) * size / 1000 + charSpacing;
                  width += advance;
                  if (leading && value != null && !value.trim()) leadingWidth += advance;
                  else leading = false;
                }
              }
              return { width, leadingWidth };
            },
            encodeText: value => PDFHexString.of(Array.from(value, char => {
              if (!codes.has(char)) throw new Error('原字体子集不含该字形');
              return codes.get(char);
            }).join('')),
            widthOfTextAtSize: (value, size) => Array.from(value, char => widths.get(parseInt(codes.get(char), 16)) ?? defaultWidth).reduce((sum, width) => sum + width, 0) * size / 1000,
            heightAtSize: (size, options = {}) => (ascent - (options.descender === false ? 0 : descent)) * size / 1000
          };
          fontCache.set(cacheKey, font);
        }
        if (canEncodePdfVectorText(font, text)) return font;
      }
      return null;
    };

const getOriginalPdfMixedFont = (doc, page, cache, originalName, text, primaryFont = null) => {
      if (!page || !originalName) return null;
      const primary = primaryFont || getOriginalPdfFont(doc, page, cache, originalName, '');
      if (!primary) return null;
      const resources = doc.context.lookup(page.node.Resources()?.get(PDFLib.PDFName.of('Font'))), fonts = [primary];
      for (const [, ref] of resources?.entries?.() || []) {
        const name = doc.context.lookup(ref)?.get?.(PDFLib.PDFName.of('BaseFont'))?.decodeText?.();
        if (!name || app.originalFontKey(name) !== app.originalFontKey(originalName)) continue;
        const font = getOriginalPdfFont(doc, page, cache, name, '');
        if (font && !fonts.some(value => String(value.originalRef) === String(font.originalRef))) fonts.push(font);
      }
      const runs = value => {
        const result = [];
        for (const character of value) {
          const font = fonts.find(font => canEncodePdfVectorText(font, character));
          if (!font) throw new Error(`原字体缺少字符：${character}`);
          const last = result.at(-1);
          if (last?.font === font) last.text += character;else result.push({ font, text: character });
        }
        return result;
      };
      let missing = [...new Set(text.replace(/\n/g, ''))].filter(character => !fonts.some(font => canEncodePdfVectorText(font, character)));
      if (missing.length) {
        if (!cache.has('original-font-resources')) cache.set('original-font-resources', doc.context.enumerateIndirectObjects().filter(([, dict]) => typeof dict.get === 'function' && String(dict.get(PDFLib.PDFName.of('Type'))) === '/Font' && String(dict.get(PDFLib.PDFName.of('Encoding'))) === '/Identity-H'));
        for (const [ref, dict] of cache.get('original-font-resources')) {
          if (fonts.some(font => String(font.originalRef) === String(ref))) continue;
          const name = dict.get(PDFLib.PDFName.of('BaseFont'))?.decodeText?.();
          if (!name || app.originalFontKey(name) !== app.originalFontKey(originalName)) continue;
          const resources = doc.context.obj({ Font: { OriginalFallback: ref } });
          const font = getOriginalPdfFont(doc, { node: { Resources: () => resources } }, cache, name, '');
          if (!font || !missing.some(character => canEncodePdfVectorText(font, character))) continue;
          fonts.push(font);missing = missing.filter(character => !canEncodePdfVectorText(font, character));
          if (!missing.length) break;
        }
      }
      if (missing.length) return null;
      return { originalFonts: fonts, runs, encodeText: value => { runs(value);return PDFLib.PDFHexString.of(''); }, widthOfTextAtSize: (text, size) => runs(text).reduce((width, run) => width + run.font.widthOfTextAtSize(run.text, size), 0), heightAtSize: (size, options) => primary.heightAtSize(size, options) };
    };

// 替换文字按字符分派：中文宋体，英文、数字、标点等其他字符新宋体。
const replacementPolicyFonts = new Map();
const isReplacementHan = character => /\p{Script=Han}/u.test(character);
// 选择器只决定目标字库，不参与原 PDF 字体解码；缺字按同类常规字库回退。
const getPolicyCandidates = category => {
      const get=role=>replacementPolicyFonts.get(role),automatic=name=>automaticFontFaces.get(name);
      const key=app.fontSettings?.[category]||(category==='chinese'?'simsun':'nsimsun');
      const fonts={
        simsun:category==='chinese'?[get('song'),get('songFallback')]:[get('simsunLatin'),get('newSongFallback'),automatic('DejaVuSerif')],
        nsimsun:category==='chinese'?[get('song'),get('songFallback')]:[get('nsimsun'),get('newSongFallback'),automatic('DejaVuSerif')],
        'sans-serif':[automatic('DejaVuSans'),get('simhei')]
      };
      return [...new Set([...(fonts[key]||fonts.simsun),get('arabicFallback'),automatic('DejaVuSans'),get('songFallback'),get('newSongFallback')].filter(Boolean))];
    };
let replacementSubsetCorpus=null;
const prepareReplacementSubsetCorpus=()=>{
      const sourceDoc=app.pdfDoc,imported=app.importedTexts,global=!!app.fontSettings?.enabled;
      if(replacementSubsetCorpus?.doc===sourceDoc&&replacementSubsetCorpus.imported===imported&&replacementSubsetCorpus.global===global)return replacementSubsetCorpus.promise;
      const entry={doc:sourceDoc,imported,global,text:null,promise:null};
      entry.promise=(async()=>{
        const parts=[...imported.values(),...(app.mergeRecords||[]).map(record=>record.mergedText),'...'];
        if(global||app.regionEditor?.size)for(let pageNum=1;pageNum<=sourceDoc.numPages;pageNum++){
          if(!global&&!app.regionEditor.pages().has(pageNum))continue;
          if(app.pdfDoc!==sourceDoc)throw new Error('PDF 已切换');
          const content=await app.getPageTextContent(pageNum);for(const item of content.items)if(item.str)parts.push(item.str);
        }
        entry.text=[...new Set(parts.join(''))].join('');return entry.text;
      })();replacementSubsetCorpus=entry;return entry.promise;
    };
const policyCssFaces=new Map();
let policyUnicodeRanges;
const getPolicyUnicodeRanges=()=>{
      if(policyUnicodeRanges)return policyUnicodeRanges;
      const ranges={chinese:[],other:[]};let start=0,prior=isReplacementHan(String.fromCodePoint(0))?'chinese':'other';
      for(let code=1;code<=0x110000;code++){
        const category=code===0x110000?'end':isReplacementHan(String.fromCodePoint(code))?'chinese':'other';
        if(category!==prior){ranges[prior].push(`U+${start.toString(16)}-${(code-1).toString(16)}`);start=code;prior=category;}
      }
      return policyUnicodeRanges={chinese:ranges.chinese.join(','),other:ranges.other.join(',')};
    };
const policyCssName=(category,font)=>`pdf-policy-${category}-${font.name.replace(/[^a-z0-9-]/gi,'-')}`;
const getPolicyCssFamily=()=>{
      const families=['chinese','other'].flatMap(category=>getPolicyCandidates(category).map(font=>`"${policyCssName(category,font)}"`));
      return [...families,'serif'].join(',');
    };
const preparePolicyCssFaces=async()=>{
      const ranges=getPolicyUnicodeRanges();
      for(const category of ['chinese','other'])for(const font of getPolicyCandidates(category)){
        const family=policyCssName(category,font);
        if(!policyCssFaces.has(family))policyCssFaces.set(family,(async()=>{
          try{return await new FontFace(family,font.data,{unicodeRange:ranges[category],weight:'400',style:'normal'}).load();}
          catch(error){console.warn('选择层字体未载入，页面底图和PDF仍使用同一矢量字库。',error);return null;}
        })());
        const face=await policyCssFaces.get(family);
        if(face){document.fonts.add(face);importedFontFaces.set(`policy:${family}`,{...font,face,loadedName:family});}
      }
    };
const prepareReplacementPolicyFonts = async () => {
      await prepareAutomaticFonts();
      const programs=[...app.fontPrograms.replacement,...(app.fontPrograms.choices||[]),{role:'simsunLatin',name:'PDFChoice-SimSunLatin',postScriptName:'SimSun',data:ORIGINAL_SIMSUN_LATIN.data}];
      for(const program of programs){
        let font=replacementPolicyFonts.get(program.role);
        if(!font){
          const data=app.dataUrlToUint8Array(`data:font/ttf;base64,${program.data}`),family=`pdf-replacement-${program.role}`;
          font={name:program.name,postScriptName:program.postScriptName||program.name,aliases:[program.name],data,loadedName:family};replacementPolicyFonts.set(program.role,font);importedFontFaces.set(program.name,font);
          try{font.face=await new FontFace(family,data,{...(program.role.startsWith('song')?{unicodeRange:'U+2E80-2FFF,U+3005,U+3007,U+3021-3029,U+3038-303B,U+3400-9FFF,U+F900-FAFF,U+20000-323AF'}:{})}).load();}catch(error){console.warn('替换字库的浏览器字体未载入，PDF预览仍使用同一内嵌字库。',error);}
        }
        if(font.face)document.fonts.add(font.face);importedFontFaces.set(font.name,font);
      }
    };

const getReplacementPolicyVectorFont = async (doc,cache,text,weight,style) => {
      await prepareReplacementPolicyFonts();
      await preparePolicyCssFaces();
      await prepareReplacementSubsetCorpus();
      const newSong=replacementPolicyFonts.get('nsimsun');
      const chosen=new Map(),groups=new Map();
      for(const character of new Set(app.normalizePdfVectorText(text).replace(/\n/g,''))){
        const candidates=getPolicyCandidates(isReplacementHan(character)?'chinese':'other');
        const font=candidates.find(font=>fontCoversText(font,character));
        if(!font)throw new Error(`替换字库缺少字符 U+${character.codePointAt(0).toString(16).toUpperCase()}，完整文字已保留。`);
        chosen.set(character,font);groups.set(font,(groups.get(font)||'')+character);
      }
      if(!groups.size)groups.set(newSong,' ');
      const vectors=new Map([...groups].map(([font,characters])=>[font,getPreparedOriginalVectorFont(doc,cache,font.name,characters)]));
      if([...vectors.values()].some(font=>!font))throw new Error('无法准备统一替换字库。');
      const runs=value=>{
        const output=[];
        for(const character of value){const font=vectors.get(chosen.get(character));if(!font)throw new Error('替换字体的字符集合发生变化。');if(output.at(-1)?.font===font)output.at(-1).text+=character;else output.push({font,text:character});}
        return output;
      };
      const fonts=[...vectors.values()];
      // Some CJK faces declare a descender smaller than their real outlines.
      // Keep the baseline and font size, but reserve enough height for the actual
      // characters. Otherwise a fitting label gets clipped and marked in red.
      const ink=runs(app.normalizePdfVectorText(text).replace(/\n/g,'')).map(run=>run.font.inkBoundsAtSize(run.text,1));
      const ascent=Math.max(0,...fonts.map(font=>font.heightAtSize(1,{descender:false})),...ink.map(box=>box.ascent));
      const descent=Math.max(0,...fonts.map(font=>font.heightAtSize(1)-font.heightAtSize(1,{descender:false})),...ink.map(box=>box.descent));
      return {originalFonts:fonts,runs,replacementPolicy:true,syntheticBold:false,syntheticItalic:false,
        encodeText:value=>{runs(value);return PDFLib.PDFHexString.of('');},
        widthOfTextAtSize:(value,size)=>runs(value).reduce((sum,run)=>sum+run.font.widthOfTextAtSize(run.text,size),0),
        inkBoundsAtSize:(value,size)=>{
          const bounds=runs(value.replace(/\n/g,'')).map(run=>run.font.inkBoundsAtSize(run.text,size));
          const stroke=0;
          return {ascent:Math.max(0,...bounds.map(box=>box.ascent))+stroke,descent:Math.max(0,...bounds.map(box=>box.descent))+stroke};
        },
        heightAtSize:(size,options={})=>size*(ascent+(options.descender===false?0:descent))};
    };

const getPdfVectorFont = async (pdfLibDoc, fontCache, fontFamily, fontWeight, fontStyle, source = {}) => {
      return getReplacementPolicyVectorFont(pdfLibDoc,fontCache,source.text||'',fontWeight,fontStyle);

    };

const canEncodePdfVectorText = (font, text) => {
      try {
        font.encodeText(app.normalizePdfVectorText(text).replace(/\n/g, ''));
        return true;
      } catch (err) {
        return false;
      }
    };

const IMPORTED_CJK_SERIF_FONT_FAMILY = '"NSimSun", "SimSun", "Songti SC", "STSong", "Noto Serif CJK SC", "Noto Serif SC", serif';

const IMPORTED_LATIN_SERIF_FONT_FAMILY = '"Times New Roman", "Liberation Serif", serif';

const IMPORTED_LATIN_SANS_FONT_FAMILY = 'Arial, "Helvetica Neue", "Liberation Sans", sans-serif';

const IMPORTED_MONOSPACE_FONT_FAMILY = '"Courier New", "Liberation Mono", monospace';
return {get replacementSubsetCorpus(){return replacementSubsetCorpus;},set replacementSubsetCorpus(value){replacementSubsetCorpus=value;},get getPolicyCandidates(){return getPolicyCandidates;},get getPolicyCssFamily(){return getPolicyCssFamily;},get isReplacementHan(){return isReplacementHan;},get replacementPolicyFonts(){return replacementPolicyFonts;},get getReplacementPolicyVectorFont(){return getReplacementPolicyVectorFont;},get fontFaceFamilyCache(){return fontFaceFamilyCache;},
get getCompleteSimSunVectorFont(){return getCompleteSimSunVectorFont;},
get AUTOMATIC_FONT_PROGRAMS(){return AUTOMATIC_FONT_PROGRAMS;},
get automaticFontFaces(){return automaticFontFaces;},
get prepareAutomaticFonts(){return prepareAutomaticFonts;},
get getAutomaticFont(){return getAutomaticFont;},
get getAutomaticVectorFont(){return getAutomaticVectorFont;},
get getDominantSourceItem(){return getDominantSourceItem;},
get originalFontKey(){return originalFontKey;},
get findPreparedOriginalFont(){return findPreparedOriginalFont;},
get readOriginalFontFaces(){return readOriginalFontFaces;},
get subsetOriginalFont(){return subsetOriginalFont;},
get getPreparedOriginalVectorFont(){return getPreparedOriginalVectorFont;},
get replacementFontMetrics(){return replacementFontMetrics;},
get measureReplacementText(){return measureReplacementText;},
get getStableImportedFontFamily(){return getStableImportedFontFamily;},
get ORIGINAL_SIMSUN_LATIN(){return ORIGINAL_SIMSUN_LATIN;},
get readTrueTypeFont(){return readTrueTypeFont;},
get rebuildTrueTypeFont(){return rebuildTrueTypeFont;},
get originalLatinFont(){return originalLatinFont;},set originalLatinFont(value){originalLatinFont=value;},
get completeOriginalFont(){return completeOriginalFont;},
get fontCoverageCache(){return fontCoverageCache;},
get importedFontFaces(){return importedFontFaces;},
get originalPdfFontObjects(){return originalPdfFontObjects;},
get importedFontPreparation(){return importedFontPreparation;},set importedFontPreparation(value){importedFontPreparation=value;},
get prepareImportedFonts(){return prepareImportedFonts;},
get fontCoversText(){return fontCoversText;},
get getLoadedPdfFont(){return getLoadedPdfFont;},
get replacementMetricDocument(){return replacementMetricDocument;},set replacementMetricDocument(value){replacementMetricDocument=value;},
get originalFontSequence(){return originalFontSequence;},set originalFontSequence(value){originalFontSequence=value;},
get replacementMetricFonts(){return replacementMetricFonts;},
get getPreviewBaselineOffset(){return getPreviewBaselineOffset;},
get getReplacementMetrics(){return getReplacementMetrics;},
get getReplacementSourceFont(){return getReplacementSourceFont;},
get getReplacementFontFamily(){return getReplacementFontFamily;},
get unquoteFontFamily(){return unquoteFontFamily;},
get quoteFontFamily(){return quoteFontFamily;},
get isGenericFontFamily(){return isGenericFontFamily;},
get findFontFaceFamily(){return findFontFaceFamily;},
get inferFontWeight(){return inferFontWeight;},
get resolveOriginalSpanFontInfo(){return resolveOriginalSpanFontInfo;},
get getPdfStandardFontName(){return getPdfStandardFontName;},
get getOriginalPdfFont(){return getOriginalPdfFont;},
get getOriginalPdfMixedFont(){return getOriginalPdfMixedFont;},
get getPdfVectorFont(){return getPdfVectorFont;},
get canEncodePdfVectorText(){return canEncodePdfVectorText;},
get IMPORTED_CJK_SERIF_FONT_FAMILY(){return IMPORTED_CJK_SERIF_FONT_FAMILY;},
get IMPORTED_LATIN_SERIF_FONT_FAMILY(){return IMPORTED_LATIN_SERIF_FONT_FAMILY;},
get IMPORTED_LATIN_SANS_FONT_FAMILY(){return IMPORTED_LATIN_SANS_FONT_FAMILY;},
get IMPORTED_MONOSPACE_FONT_FAMILY(){return IMPORTED_MONOSPACE_FONT_FAMILY;}};
}});
