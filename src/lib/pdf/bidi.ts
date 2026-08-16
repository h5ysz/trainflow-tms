// Visual-order word reordering for pdfkit text drawing.
//
// pdfkit lays out each word independently (via fontkit) and draws words
// left-to-right. Arabic words are shaped correctly per word, but logical-order
// strings (first word = rightmost) would come out mirrored. Fontkit's whole-line
// layout is no better: it reverses embedded Latin runs inside RTL text. So this
// module applies UAX #9 rule L2 at word granularity and returns a string already
// in visual order; each word keeps its own character order because fontkit
// re-shapes it, and inter-word spaces stay between the words they belonged to.
//
// In an RTL paragraph Latin words sit at embedding level 2, so they are reversed
// once by the level-1 pass and once by the level-2 pass (net effect: LTR blocks
// keep their order and are moved to the far left of the line).

const ARABIC_LETTER_RE = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;
const SPACE_RE = /^\s+$/;

export function orderTextForLtr(text: string): string {
  const tokens = text.match(/\s+|\S+/g) ?? [];
  if (tokens.length <= 1) return text;

  const isSpace = (token: string) => SPACE_RE.test(token);
  const isArabic = (token: string) => ARABIC_LETTER_RE.test(token);

  let baseLevel = 0;
  for (const token of tokens) {
    if (isSpace(token)) continue;
    baseLevel = isArabic(token) ? 1 : 0;
    break;
  }

  const levels: Array<0 | 1 | 2 | null> = tokens.map((token) => {
    if (isSpace(token)) return null;
    if (!isArabic(token)) return baseLevel === 1 ? 2 : 0;
    return 1;
  });

  const order = tokens.slice();
  let maxLevel = 0;
  for (const level of levels) {
    if (level !== null && level > maxLevel) maxLevel = level;
  }
  for (let level = maxLevel; level >= 1; level--) {
    let i = 0;
    while (i < order.length) {
      if ((levels[i] ?? 0) < level) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j + 1 < order.length && isSpace(order[j]) && (levels[j + 1] ?? 0) >= level) {
        j += 2;
      }
      for (let lo = i, hi = j - 1; lo < hi; lo++, hi--) {
        const tmp = order[lo];
        order[lo] = order[hi];
        order[hi] = tmp;
      }
      i = j;
    }
  }

  return order.join("");
}
