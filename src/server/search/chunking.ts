/**
 * Splits a document into search chunks of roughly `target` characters.
 * Paragraph boundaries are preferred, then sentence boundaries; a chunk
 * never exceeds `max` characters (the database CHECK allows 4000).
 * Smaller chunks make matches more precise; each chunk carries the
 * document title so a chunk out of context still says what it is about.
 */
export function chunkDocument(title: string, body: string, target = 700, max = 1500): string[] {
  const pieces: string[] = [];
  for (const paragraph of body.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const text = paragraph.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (text.length <= max) {
      pieces.push(text);
      continue;
    }
    // Long paragraph: split on sentence ends, hard-split anything still too long.
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      for (let i = 0; i < sentence.length; i += max) pieces.push(sentence.slice(i, i + max));
    }
  }

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > target) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) chunks.push(current);

  const heading = title.trim();
  return (chunks.length > 0 ? chunks : [heading]).map((chunk) => `${heading}: ${chunk}`.slice(0, 3900));
}
