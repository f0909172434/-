// The river's corpus: every line is someone's question about someone they love. Written for the film, by era.
// Nothing here is a real person's message; names, addresses and dates are plausible, the formats are faithful
// (RFC 822 headers, Usenet and PTT BBS headers, ITA2 5-unit telegraph code, Qing-era family letters, temple
// fortune-slip verses, the yarrow-stalk procedure of the Xici commentary).

// ------------------------------------------------------------------------------------------ 2026: the present
// [language, text]. Weighted toward Traditional Chinese and English (the film's two languages).
export const Q2026 = [
  // zh-Hant
  ['zh', '她會好起來嗎？'], ['zh', '媽媽的手術會成功嗎？'], ['zh', '爸爸還認得我嗎？'], ['zh', '化療有用嗎？'],
  ['zh', '腫瘤是良性的嗎？'], ['zh', '她還有多少時間？'], ['zh', '他會醒過來嗎？'], ['zh', '要不要告訴她實話？'],
  ['zh', '寶寶會平安嗎？'], ['zh', '還有別的治療方法嗎？'], ['zh', '阿嬤今晚撐得過去嗎？'], ['zh', '爸爸會不會痛？'],
  ['zh', '復發的機率高嗎？'], ['zh', '她聽得到我說話嗎？'], ['zh', '我現在趕回去來得及嗎？'], ['zh', '為什麼是她？'],
  ['zh', '這個病會遺傳嗎？'], ['zh', '他還能走路嗎？'], ['zh', '我能為她做什麼？'], ['zh', '早一點發現會不一樣嗎？'],
  ['zh', '她還會記得我嗎？'], ['zh', '媽媽一個人在加護病房會怕嗎？'], ['zh', '指數下降是好事嗎？'], ['zh', '開刀的風險有多大？'],
  ['zh', '弟弟的燒為什麼一直不退？'], ['zh', '是我害的嗎？'], ['zh', '還要等多久才有結果？'], ['zh', '他吃不下東西，正常嗎？'],
  ['zh', '出院以後要注意什麼？'], ['zh', '醫生說「再觀察」是什麼意思？'], ['zh', '我應該辭職回家照顧她嗎？'], ['zh', '她會不會很害怕？'],
  ['zh', '安寧病房是什麼？'], ['zh', '我的狗還能撐多久？'], ['zh', '插管以後還能說話嗎？'], ['zh', '第四期還有機會嗎？'],
  ['zh', 'CEA 12.4 很高嗎？'], ['zh', '切片報告寫「疑似惡性」是什麼意思？'], ['zh', '外婆還能回家過年嗎？'], ['zh', '我可以留下來陪她過夜嗎？'],
  ['zh', '他會好起來吧？'], ['zh', '我該怎麼跟孩子說？'], ['zh', '她醒來會不會不記得我？'], ['zh', '爸爸今天會不會比較好？'],
  // zh-Hans
  ['zh', '妈妈会好起来吗？'], ['zh', '我爸的病还能治吗？'], ['zh', '化疗要做几次？'], ['zh', '孩子发烧三天了，要紧吗？'],
  ['zh', '奶奶还能撑多久？'], ['zh', '手术成功率高吗？'], ['zh', '肺上的结节是癌吗？'], ['zh', '他还能醒过来吗？'],
  // ja
  ['ja', 'お母さんは助かりますか'], ['ja', '父の手術はうまくいきますか'], ['ja', '祖母はまた歩けるようになりますか'],
  ['ja', '娘の熱が下がりません。大丈夫でしょうか'], ['ja', '夫はまた目を覚ましますか'], ['ja', 'この病気は治りますか'],
  ['ja', 'あとどれくらい一緒にいられますか'], ['ja', '母は痛みを感じていますか'], ['ja', '抗がん剤は効いていますか'],
  ['ja', '赤ちゃんは無事に生まれますか'], ['ja', '今夜が峠でしょうか'], ['ja', 'もう一度話せますか'],
  ['ja', '父に本当のことを伝えるべきですか'], ['ja', '猫の手術は成功しますか'],
  // ko
  ['ko', '엄마 괜찮을까요?'], ['ko', '아빠 수술은 잘 될까요?'], ['ko', '할머니가 저를 알아보실까요?'], ['ko', '이 병은 나을 수 있나요?'],
  ['ko', '우리 아기 괜찮을까요?'], ['ko', '남편이 다시 깨어날까요?'], ['ko', '항암 치료가 효과가 있을까요?'],
  ['ko', '얼마나 더 버틸 수 있을까요?'], ['ko', '다시 걸을 수 있을까요?'], ['ko', '지금 가도 늦지 않았을까요?'],
  // en
  ['en', 'Will she be okay?'], ['en', 'Will my dad wake up?'], ['en', 'Is it serious?'], ['en', 'How long does she have?'],
  ['en', 'Is chemo worth it at 82?'], ['en', 'Can he hear me?'], ['en', 'What are the chances it comes back?'], ['en', 'Is it my fault?'],
  ['en', 'Should I fly home tonight?'], ['en', 'Will the surgery work?'], ['en', 'Is it normal that he sleeps all day?'],
  ['en', 'What do I tell the kids?'], ['en', 'Is the tumor benign?'], ['en', 'Will she remember me?'],
  ['en', 'Is there anything else we can try?'], ['en', "Why won't the fever go down?"], ['en', 'Is my baby going to be okay?'],
  ['en', "How do I know if he's in pain?"], ['en', 'What does stage 3 mean?'], ['en', 'Will mom get better?'], ['en', 'Does it hurt?'],
  ['en', 'Will he walk again?'], ['en', 'Is it too late?'], ['en', 'How do I say goodbye?'], ['en', 'Can I stay with her tonight?'],
  ['en', 'What does "suspicious for malignancy" mean?'], ['en', 'Is a PSA of 9.1 bad?'], ['en', 'Should we stop treatment?'],
  ['en', "Will she know I'm there?"], ['en', 'Is he comfortable?'], ['en', 'How long until we hear back?'],
  // es
  ['es', '¿Mi hijo va a estar bien?'], ['es', '¿Mi madre se va a curar?'], ['es', '¿Cuánto tiempo le queda?'], ['es', '¿La operación saldrá bien?'],
  ['es', '¿Es grave?'], ['es', '¿Me puede oír?'], ['es', '¿Volverá a caminar?'], ['es', '¿La quimio va a funcionar?'],
  ['es', '¿Por qué no le baja la fiebre?'], ['es', '¿Mi papá va a despertar?'], ['es', '¿Puedo quedarme con ella esta noche?'],
  ['es', '¿Se va a poner bien mi abuela?'],
  // pt
  ['pt', 'Ela vai ficar bem?'], ['pt', 'Minha mãe vai se curar?'], ['pt', 'A cirurgia vai dar certo?'], ['pt', 'Quanto tempo ele ainda tem?'],
  ['pt', 'Meu filho vai ficar bom?'], ['pt', 'Ele vai acordar?'],
  // fr
  ['fr', 'Est-ce qu’elle va guérir ?'], ['fr', 'Mon père va-t-il se réveiller ?'], ['fr', 'Est-ce grave ?'],
  ['fr', 'Combien de temps lui reste-t-il ?'], ['fr', 'L’opération va-t-elle réussir ?'], ['fr', 'Est-ce qu’il m’entend ?'],
  ['fr', 'Est-ce qu’elle souffre ?'],
  // de
  ['de', 'Wird er wieder gesund?'], ['de', 'Wird meine Mutter wieder gesund?'], ['de', 'Ist es schlimm?'], ['de', 'Wie lange hat sie noch?'],
  ['de', 'Wacht er wieder auf?'], ['de', 'Hat sie Schmerzen?'], ['de', 'Kann ich bei ihr bleiben?'],
  // it nl pl
  ['it', 'Starà meglio?'], ['it', 'Mia madre guarirà?'], ['it', 'È grave?'], ['it', 'Quanto tempo le resta?'],
  ['nl', 'Wordt ze weer beter?'], ['nl', 'Is het ernstig?'], ['nl', 'Komt hij er weer bovenop?'],
  ['pl', 'Czy on wyzdrowieje?'], ['pl', 'Czy mama będzie zdrowa?'], ['pl', 'Czy to coś poważnego?'],
  // ru uk el
  ['ru', 'Он поправится?'], ['ru', 'Мама выздоровеет?'], ['ru', 'Сколько ей осталось?'], ['ru', 'Операция пройдёт успешно?'], ['ru', 'Это опасно?'],
  ['uk', 'Мама одужає?'], ['uk', 'Він прокинеться?'],
  ['el', 'Θα γίνει καλά;'], ['el', 'Είναι σοβαρό;'],
  // tr vi id tl sw sv no da fi cs hu ro
  ['tr', 'Annem iyileşecek mi?'], ['tr', 'Ameliyat başarılı olacak mı?'], ['tr', 'Ciddi mi?'],
  ['vi', 'Mẹ tôi có khỏi bệnh không?'], ['vi', 'Ca mổ có thành công không?'],
  ['id', 'Apakah ibu saya akan sembuh?'], ['id', 'Apakah operasinya akan berhasil?'],
  ['tl', 'Gagaling pa ba si Nanay?'], ['sw', 'Je, mama atapona?'], ['sv', 'Kommer hon att bli frisk?'], ['no', 'Blir hun frisk igjen?'],
  ['da', 'Bliver hun rask igen?'], ['fi', 'Paraneeko äiti?'], ['cs', 'Uzdraví se?'], ['hu', 'Meg fog gyógyulni?'], ['ro', 'Mama o să se facă bine?'],
  // ar fa ur he hi th
  ['ar', 'هل ستشفى أمي؟'], ['ar', 'هل سيستيقظ أبي؟'], ['ar', 'هل المرض خطير؟'], ['ar', 'كم بقي له من الوقت؟'], ['ar', 'هل ستنجح العملية؟'],
  ['fa', 'مادرم خوب می‌شود؟'], ['fa', 'عمل جراحی موفق می‌شود؟'], ['ur', 'کیا امی ٹھیک ہو جائیں گی؟'],
  ['he', 'האם הוא יבריא?'], ['he', 'האם אמא תהיה בסדר?'],
  ['hi', 'क्या वह ठीक हो जाएगी?'], ['hi', 'क्या माँ ठीक हो जाएँगी?'], ['hi', 'क्या ऑपरेशन सफल होगा?'], ['hi', 'क्या पापा को होश आएगा?'],
  ['th', 'แม่จะหายไหม'], ['th', 'พ่อจะฟื้นไหม'], ['th', 'ภรรยาผมจะหายไหม'],
];
// Latin-script lines read best in Noto Sans (Latin first); CJK lines in Noto Sans TC (JP / KR pick their face).
export const LATIN = new Set(['en', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'pl', 'ru', 'uk', 'el', 'tr', 'vi', 'id', 'tl', 'sw', 'sv', 'no', 'da', 'fi', 'cs', 'hu', 'ro']);
export const LANG_W = { zh: 3.2, en: 2.0, ja: 1.2, ko: 1.0, es: 1.0 };   // sampling weights (others 0.7)

// ------------------------------------------------------------------------------------------ 1998: e-mail, Usenet, BBS
export const MAIL_FROM = [
  'From: Karen Whitfield <kwhitfield@aol.com>', 'From: "J. Ortega" <jortega@hotmail.com>', 'From: dkowalski@compuserve.com',
  'From: "Mei-ling Chen" <mlchen@ms12.hinet.net>', 'From: s.mueller@t-online.de', 'From: tanaka.k@nifty.ne.jp',
  'From: rgupta@vsnl.com', 'From: "Ann B." <annb@earthlink.net>', 'From: pbrennan@netcom.com', 'From: lwong@netvigator.com',
];
export const MAIL_DATE = [
  'Date: Thu, 12 Mar 1998 03:12:44 +0800', 'Date: Sat, 21 Mar 1998 02:14:09 -0500', 'Date: Mon, 6 Apr 1998 23:51:30 +0100',
  'Date: Tue, 14 Jul 1998 04:02:17 +0900', 'Date: Fri, 30 Oct 1998 01:37:55 -0800', 'Date: Sun, 22 Nov 1998 03:40:02 -0500',
];
export const MAIL_SUBJ = [
  "Subject: Re: Mom's biopsy results", 'Subject: dad starts chemo monday. what should we expect?', 'Subject: Re: Re: is there any hope?',
  'Subject: Will he wake up?', 'Subject: question about stage III', 'Subject: Re: my sister -- is it serious?',
  'Subject: 媽媽的檢查報告', 'Subject: Re: 爸爸的手術', 'Subject: baby still has fever (4 days)', 'Subject: Re: How is your mother?',
];
export const NEWS = [
  'Newsgroups: alt.support.cancer', 'Newsgroups: sci.med.diseases.cancer', 'Newsgroups: alt.support.alzheimers', 'Newsgroups: misc.kids.health',
  '作者: lily0412 (小莉) 看板: Health', '標題: [問題] 媽媽開刀後一直發燒', '時間: Thu Mar 12 03:12:44 1998', '標題: Re: [問題] 化療會有用嗎',
];
export const MAIL_QUOTE = [
  "> They want to wait two more weeks.", "> > is it normal that she sleeps all day?", '> Any advice would be appreciated.', '> Will it come back?',
  "> Has anyone's mother had this surgery at 70?", '> Is there anything else we can try?', '> 醫生說要再觀察。', '> 她會好起來嗎？',
  '> How long did your dad have after that?', "> I don't know what to ask the doctor.",
];
export const MAIL_RULE = ['-----Original Message-----', '-- ', '________________________________________', 'Sent: Tuesday, July 14, 1998 4:02 AM'];
export const MAIL_HERO = [
  'From:    Karen Whitfield <kwhitfield@aol.com>',
  'Date:    Sat, 21 Mar 1998 02:14:09 -0500',
  "Subject: Re: Mom's biopsy results",
  '',
  '> They want to wait two more weeks.',
  '> Is it serious? Will she be okay?',
];

// ------------------------------------------------------------------------------------------ 1931: telegraph tape
// ITA2 (Baudot-Murray) 5-unit code, bits 1..5 (1 = hole). Letters case; FIGS/LTRS shifts for digits.
export const ITA2 = {
  A: '11000', B: '10011', C: '01110', D: '10010', E: '10000', F: '10110', G: '01011', H: '00101', I: '01100', J: '11010',
  K: '11110', L: '01001', M: '00111', N: '00110', O: '00011', P: '01101', Q: '11101', R: '01010', S: '10100', T: '00001',
  U: '11100', V: '01111', W: '11001', X: '10111', Y: '10101', Z: '10001', ' ': '00100',
};
const ITA2_FIG = { 1: '11101', 2: '11001', 3: '10000', 4: '01010', 5: '00001', 6: '10101', 7: '11100', 8: '01100', 9: '00011', 0: '01101' };
const FIGS = '11011', LTRS = '11111';
// One column per transmitted character: { ch (printed, or '' for a shift), code }
export function ita2Columns(msg) {
  const cols = []; let fig = false;
  for (const ch of msg.toUpperCase()) {
    if (ITA2_FIG[ch] != null) { if (!fig) { cols.push({ ch: '', code: FIGS }); fig = true; } cols.push({ ch, code: ITA2_FIG[ch] }); continue; }
    if (ITA2[ch] == null) continue;
    if (fig && ch !== ' ') { cols.push({ ch: '', code: LTRS }); fig = false; }
    cols.push({ ch, code: ITA2[ch] });
  }
  return cols;
}
export const TELEGRAMS = [
  'MOTHER GRAVELY ILL STOP COME AT ONCE', 'IS SHE BETTER STOP WIRE REPLY', 'FATHER SINKING STOP SHALL I COME', 'HOW IS BABY STOP ANXIOUS',
  'OPERATION TOMORROW STOP PRAY FOR HER', 'ANY HOPE STOP WIRE TONIGHT', 'IS IT SERIOUS STOP ADVISE', 'SHALL I COME HOME STOP REPLY PAID',
  'HOW IS JOHN STOP CAN WE VISIT', 'WIRE NEWS OF MOTHER STOP WAITING', 'IS FEVER LOWER STOP WIRE', 'WILL SHE LIVE STOP WIRE TRUTH',
];
export const TELEGRAM_HERO = 'MOTHER GRAVELY ILL STOP COME AT ONCE';

// ------------------------------------------------------------------------------------------ 1868: letters
// Qing family letters (同治七年 = 1868), unpunctuated as written; vertical, right to left.
export const LETTER_ZH = [
  '母親病重速歸', '家慈病勢日沉未知能否轉安', '小兒出痘未卜吉凶', '聞令堂貴恙近日可曾稍減', '老父病篤可望痊癒否',
  '內人產後虛弱不知能否復原', '吾兒知悉汝母病已月餘', '醫者束手未知能否挽回', '見信速歸', '同治七年三月初五',
];
export const LETTER_EN = [
  'My dearest Mother, is there any hope?', 'Dear Brother, Father is very low. Will you come?', 'Pray tell me, is she any better?',
  'Will he live to see the spring?', 'The doctor came again today.', 'Is little Emma out of danger?', 'Write by return of post.',
  'London, 14th March 1868', 'Boston, Nov. 12th, 1868',
];
// the hero letter: columns right to left
export const LETTER_HERO_ZH = ['吾兒知悉', '汝母病已月餘', '醫者束手', '未知能否挽回', '見信速歸', '父字', '同治七年三月初五'];
export const LETTER_HERO_EN = ['London, 14th March 1868', 'My dear Brother,', 'Mother is very low. The doctor', 'can promise nothing. Will you come?', 'Your affectionate sister, Mary'];

// ------------------------------------------------------------------------------------------ 1750: temple slips (乾隆十五年)
// Fortune-slip verses (seven-character quatrains) as printed from woodblocks.
export const SLIP_POEMS = [
  ['甲子', ['日出便見風雲散', '光明清淨照世間', '一向前途通大道', '萬事清吉保平安']],   // 六十甲子籤 第一首
  ['第一籤', ['巍巍獨步向雲間', '玉殿千官第一班', '富貴榮華天付汝', '福如東海壽如山']], // 關帝靈籤 第一籤
  ['第一籤', ['開天闢地作良緣', '吉日良時萬物全', '若得此籤非小可', '人行忠正帝王宣']], // 觀音靈籤 第一籤
];
export const SLIP_ASK = ['弟子為母病求籤', '求問家母病體何日得安', '信女林氏叩問夫病吉凶', '小兒久病不癒求神指點', '叩問父病可得痊癒否', '為妻病求籤'];
const STEMS = '甲乙丙丁戊己庚辛壬癸', BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
export const GANZHI = Array.from({ length: 60 }, (_, i) => STEMS[i % 10] + BRANCHES[i % 12]);

// ------------------------------------------------------------------------------------------ 800 BCE: yarrow
export const YARROW_ASK = ['筮母疾其瘳', '筮子疾其瘳', '筮父疾其瘳', '筮婦疾其瘳'];
export const XICI = '大衍之數五十其用四十有九';
// 未濟 ䷿ (fire over water), lines from the bottom: 8 7 8 7 8 7 (young yin / young yang, no changing lines)
export const HEX = { name: '未濟', lines: [8, 7, 8, 7, 8, 7], judgement: '亨小狐汔濟濡其尾无攸利' };
// The first line, done in full: three changes, [left, right] after the split; one stalk hung from the right pile.
// remainders by fours (0 counts as 4): 49 -> 40 -> 36 -> 32 => 32 / 4 = 8 (young yin)
export const YARROW_CHANGES = [[24, 25], [21, 19], [17, 19]];

// ------------------------------------------------------------------------------------------ memory (the human's sentences)
export const MEMORY = ['她以前每天早上，', '都會在陽台澆花。', '她說，花會記得誰對它好。'];
