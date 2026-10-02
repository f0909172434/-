// Yijing data for the lineage scene: the eight trigrams and the 64 hexagrams in the "Fuxi" (xiantian) order
// of Shao Yong's diagrams, which is binary counting (Leibniz, 1703; Bouvet's letter of 4 Nov 1701).
//
// Convention (Leibniz's reading, checked against his "Figure de huit Cova", Mémoires de l'Académie royale
// des sciences 1703, p. 88, and the annotated woodcut Bouvet sent him, Leibniz-Archiv Hannover):
//   yang ⚊ = 1, yin ⚋ = 0; the BOTTOM line is the most significant digit (written first, on the left).
//   trigrams 0..7 = 坤 艮 坎 巽 震 離 兌 乾 (so the Fuxi order 乾兌離震巽坎艮坤 counts down 7..0).
//   hexagram v = lower trigram × 8 + upper trigram: 坤 0, 剝 1, 比 2 … 姤 31, 復 32 … 夬 62, 乾 63.
//
// Square (方圖), 8 × 8: row r (top = 0) holds lower trigram r, column c (left = 0) upper trigram c, so the cell
// (r, c) is v = 8r + c and the square reads 0..63 across and down: 坤 top-left, 否 top-right, 泰 bottom-left,
// 乾 bottom-right.
// Circle (圓圖): 乾 at the top just left of the axis, 姤 just right of it; 坤 at the bottom just right of the
// axis, 復 just left of it. 0..31 run up the right side (坤 → 姤), 32..63 up the left side (復 → 乾).
// In the circle each hexagram's first (bottom) line is innermost and its top line outermost.
export const TAU = Math.PI * 2;

export const TRIGRAM = ['坤', '艮', '坎', '巽', '震', '離', '兌', '乾'];
export const TRIGRAM_NATURE = ['地', '山', '水', '風', '雷', '火', '澤', '天'];
export const BIGRAM = ['太陰', '少陽', '少陰', '太陽'];   // 00 ⚏, 01 ⚎, 10 ⚍, 11 ⚌ (bottom line first)
export const MONOGRAM = ['陰', '陽'];

// HEX[v], v = lower * 8 + upper
export const HEX = [
  '坤', '剝', '比', '觀', '豫', '晉', '萃', '否',
  '謙', '艮', '蹇', '漸', '小過', '旅', '咸', '遯',
  '師', '蒙', '坎', '渙', '解', '未濟', '困', '訟',
  '升', '蠱', '井', '巽', '恆', '鼎', '大過', '姤',
  '復', '頤', '屯', '益', '震', '噬嗑', '隨', '无妄',
  '明夷', '賁', '既濟', '家人', '豐', '離', '革', '同人',
  '臨', '損', '節', '中孚', '歸妹', '睽', '兌', '履',
  '泰', '大畜', '需', '小畜', '大壯', '大有', '夬', '乾',
];

// line k (0 = bottom) of an n-line figure with value v: 1 = yang, 0 = yin
export const line = (v, n, k) => (v >> (n - 1 - k)) & 1;

// angle (radians, maths convention: 0 = right, CCW positive, y up) of hexagram v's sector centre in the circle
export function ringAngle(v) {
  const d = TAU / 64;
  return v < 32 ? -Math.PI / 2 + (v + 0.5) * d : 1.5 * Math.PI - (v - 32 + 0.5) * d;
}

// binary string of v with n digits, most significant (= bottom line) first
export const bin = (v, n) => v.toString(2).padStart(n, '0');
