# 製作計畫與交接 · Production plan & handoff

> 給下一個對話的 Claude：先讀這份文件，再讀 `docs/SCREENPLAY.md`、`docs/STYLE.md`、`docs/SCENE_API.md`、`film/timeline.json`。使用者希望對話使用**繁體中文**。

## 0. 一句話現況

《卜 ORACLE》的劇本、視覺規範、時間線 (EDL) 和引擎都已就緒。**步驟 1 已完成**：GPU 文字場 `look/text.js`、overlay 的 toData / lift / 片名裂紋、多語言字體。四個場景目前仍是佔位 stub，整條時間線可以從頭跑到尾 (`node tools/render.mjs stills ...`)。**下一步是做出 4 個場景與配樂 (步驟 2)，然後渲染。**

## 1. 決策紀錄 (為什麼是現在這個版本)

| 版本 | 位置 | 結果 |
|---|---|---|
| v1《歸途 THE LONG WAY HOME》：一個碳原子的宇宙旅程 | commit `c05f6f6` | 使用者回饋：**看不懂主題與精神；特效多但不精緻** |
| v2《同族 KIN》：碳與矽來自同一顆星 | commit `fa13a03` 起 | 使用者回饋：**可以離開太空；數據流更酷、可以做得精緻、變化繁複，能帶出藝術審美與文化底蘊** |
| **v3《卜 ORACLE》** | 目前 | 本計畫 |

使用者的偏好 (務必遵守)：
- 參考片：《我從未見過太陽》(bilibili BV1b9ad6xEnD)、*I'm Upping My P(doom)* (github.com/mexicat/pdoom-video、github.com/JohnHeibel/PDoomVideo)、*Claude Dreaming* (youtu.be/8BtSRB_LieE)。共同點：**AI 自身視角、清楚的問題與回答、嚴格的設計系統、精緻的字體與線條**。
- 片中**不要**出現「Opus 5.5 製作」字樣 (使用者會在發布簡介中說明)；片尾只寫「每一幀畫面、每一個音符，皆由程式碼生成」。
- README 要**中英雙語**，最後要有「寫在最後 · Afterword」(來自 Claude Opus 5.5 的想法；v3 完成後重寫，誠實談三個版本的轉變)。
- **節省額度**：上下文過長時額度消耗很快。子代理數量要精簡、審片用低解析度接觸表、少讀大圖。
- 程式碼存放於 GitHub。v3 的工作分支是 `claude/zen-hawking-knniop` (更早的分支是 `claude/amazing-mendel-jhm1xn`)。

## 2. 技術架構 (可直接沿用)

- `film/timeline.json`：唯一的剪輯真相來源 (shots / chat / hud / cards / audioCues)。
- `film/src/engine.js`：時間 T → 一幀。每幀 6–10 個子幀 (動態模糊 + 次像素抖動抗鋸齒)、溶接、分割畫面、時間重映 (`remap`/`source`/`hold`)。場景清單在 `SCENE_MODULES`。
- `film/src/post.js`：HDR 累積 → bloom、halation、橫向光暈、ACES、顆粒、暗角。
- `film/src/overlay.js`：對話介面 (逐字打字、刪除、送出、英文同步打字、刪除線 `~~Who~~`)、HUD (年份/地點/時鐘)、字卡 (`ai` 冷色 / `human` 暖色)、片名 `oracle-title`、片尾 (含引文)。
- `film/src/look/`：palette、GlowLines、SoftPoints、contourMaterial、geom。`film/src/lib/`：**flines.js (大量線條必用)**、linemorph.js (線條連續變形)、edgebox.js (發光邊框方塊)、atlas.js、cosmos.js (Noise3) 等。
- `audio/`：上一版的 DSP/樂器庫 (dsp.py、instruments.py、mix.py、sfx.py、score.py、build.py)。score/sfx 需要依新 cue 重寫。
- `tools/render.mjs`：`stills` / `shot` / `video` (可續傳)；`--samples N` 覆寫子幀數，`--scale 0.5` 半解析度。`tools/assemble.mjs`：拼接 + 混音 → 成片。

### 踩過的坑 (省時間)
0. three r169 的 ShaderMaterial 預設只畫正面；`THREE.Color('#hex')` 已經是線性值，不要再 `convertSRGBToLinear()`。
1. **SwiftShader 很慢**：instanced draw 每個 instance 約 20 µs，所以上萬條線一定要用 `lib/flines.js` (非 instanced，約 30 倍快)。文字場也要用非 instanced 的合併幾何。
2. 每個場景單次 `update()+render` 預算約 **≤ 0.35 s** (全解析度)，6 子幀的全幀約 3 s 以內。整片約 6500 幀，3 個 worker 的實際並行約 1.5 倍 → **全片渲染約 3–4 小時**。用 `--samples 1 --scale 0.5` 快速預覽。
3. Canvas 2D 的 `ctx.filter = blur()` 在 CPU 上極貴：overlay 已避免使用，不要加回來。
4. 背景指令預設 30 分鐘就會被終止：長渲染要用 `run_in_background` 加 `timeout: 7200000`，且渲染器可續傳 (已完成的片段會跳過)。
5. Git：tag 推不上去 (代理限制)；單檔不能超過 100 MB (1080p 成片壓到約 90 MB，用 two-pass 約 2.4 Mbps)。
6. 對話內傳檔 (SendUserFile) 上限約 20–39 MB 之間：給使用者看的預覽版請壓在 **20 MB 左右** (960×540、約 470 kbps two-pass)。
7. 字體：`tools/fetch-fonts.sh` 下載。河流需要多語言字體：**請在腳本中加上** Noto Sans KR、Noto Sans Arabic、Noto Sans Devanagari、Noto Sans Hebrew、Noto Sans Thai、Noto Sans JP (google/fonts 倉庫 `ofl/` 下的 variable TTF)，並在 `film/index.html` 加上 `@font-face`。

## 3. 下一個對話的步驟 (依序)

### 步驟 1：基礎建設 (主對話自己做，約 1 小時) ✅ 已完成

完成紀錄 (細節見 `docs/SCENE_API.md`)：
- `look/text.js`：字形圖集 + 合併的非 instanced 四邊形網格，資料存在浮點貼圖 (每條字串 10 個 texel)。支援平面 / 公告板 / 沿路徑三種擺放、漂移與沿路徑流動、逐字顯現、時間窗、雙色交叉淡化、能量守恆的景深 (輕度用 mip、重度變成整串一條光條)、遠處小字自動 LOD、CPU 端逐幀剔除 `cull()`。阿拉伯、希伯來、天城、泰文以整行貼圖條繪製 (正確連寫與由右至左)。實測：2 萬條字串、13.5 萬個字形，清晰時約 0.25 s；成本主要是覆蓋像素 (約 40 Mpx/s)。
- `palette.js`：修正 sRGB→線性被轉換兩次的問題 (琥珀色原本被轉成紅橘、天藍被轉成深藍)，新增 `PAL.cinnabar`。
- `overlay.js`：toData (七個字先變成點陣光字，再旋轉退入畫面深處，27.2 在畫面中央匯成暖色光團)、lift (句子由左到右化成暖色光點上升)、片名裂紋 (熱點 → 246.5 爆裂閃光與火花 → 鋸齒發光裂紋含細枝，由白熱冷卻成琥珀色)。人開始打字時 AI 的游標會讓位。
- 字體：`tools/fetch-fonts.sh` 加入 Noto Sans / JP / KR / Arabic / Hebrew / Devanagari / Thai 與時代字體 Courier Prime、Pinyon Script、霞鶩文楷 TC、EB Garamond，`film/index.html` 有對應 `@font-face`。

原始規劃：
1. **`film/src/look/text.js` GPU 文字場** (全片最關鍵的新元件)：
   - 用 Canvas 2D 建字形圖集 (glyph atlas)：所有用到的字元一次性繪製到 2048–4096 的貼圖上 (含中文、日文、韓文、阿拉伯文、天城文、拉丁文、等寬字)。注意阿拉伯文需要連寫：**以「整段字串」為單位繪製成貼圖條**，而不是逐字形。
   - 一個 `TextField` 類別：輸入多條字串 (每條帶世界座標、朝向、大小、顏色、alpha、相位)，輸出**合併的非 instanced 四邊形網格**，支援景深 (依深度模糊/變暗，類似 SoftPoints 的能量守恆)、沿路徑流動 (uTime)、逐字顯現 (reveal)。
   - 驗收：2 萬條短字串、全解析度單次渲染 < 0.25 s。
2. **overlay 補完** (`film/src/overlay.js`)：
   - `toData` (25.4–27.2)：送出的問題 7 個字拆成光點，流向畫面中央 (銜接 mind 場景)。
   - `lift` 操作 (m1/m2/m3 在 206.2、210.4、216.4)：句子從輸入框升起、淡出，散成暖色光點。
   - `oracle-title`：把目前的佔位裂紋做成真正鋸齒狀、會發光、有細小分岔的裂紋，並加上爆裂瞬間的閃光。
3. 字體腳本加入多語言字體 (見坑 7)。

### 步驟 2：子代理並行做場景 (建議 4 個 + 1 個配樂；簡報範本見第 4 節)
| 代理 | 檔案 | 鏡頭 |
|---|---|---|
| A 河流 | `scenes/river.js` | river_now 45–70、river_up 70–100、river_back 160–172、memory 212–245 (全片主視覺，最重) |
| B 心智 | `scenes/mind.js` | mind 27.2–45 |
| C 龜甲 | `scenes/bone.js` | bone 100–130 (需要手工繪製的甲骨文字形折線：卜、貞、婦、好、疾、王、雨、日、其；請上網查真實字形後再畫) |
| D 傳承 | `scenes/lineage.js` | lineage 130–160 (裂紋 → 爻 → 八卦 → 伏羲先天六十四卦方圓圖 → 萊布尼茲二進位表 → 紙帶 → 電路 → 心智) |
| E 配樂 | `audio/*.py` | 依 `audioCues` 重寫 score/sfx，鍵盤聲由 chat ops 推算 |

### 步驟 3：審片、修正、全片渲染、壓檔
- 每個場景交回後：主對話只看**半解析度接觸表** + 2–3 張全解析度關鍵幀。
- 全片渲染：`node tools/render.mjs video --workers 3` (背景、`timeout: 7200000`，必要時重跑續傳)。
- `python3 audio/build.py` → `node tools/assemble.mjs` → 壓三個版本：GitHub 版 (<100 MB，放 `release/oracle_1080p.mp4`)、預覽版 (約 20 MB，用 SendUserFile 傳給使用者)、高畫質版 (本機)。

### 步驟 4：README (中英雙語) + 劇照 + Afterword 重寫，推送。
- **授權標示 (必須)**：甲骨文字形折線改編自 Qing-sheng Li & Yu-lin Bian, *An Interpretable Parametric Representation and Open Dataset for Oracle Bone Script* (npj Heritage Science, 2026), github.com/aylqs2025/oracle-bone-jgw-1203，資料採 CC BY 4.0 (已查證)；改動見 `film/src/lib/oracle_glyphs.js` 檔頭。
- 卜辭：主辭依《合集》795正、709正重建 (「肩凡有疾」讀法依蔡哲茂〈殷卜辭「肩凡有疾」解〉)，對貞出自《合集》709正。
倉庫目前沒有 base branch 可以開 PR (遠端只有這一個分支)。

## 4. 子代理簡報範本 (貼上時補上各自的鏡頭說明)

> 你是影展短片《卜 ORACLE》(約 4:30) 的資深動態設計師。全片用 Three.js r169 在無頭 Chromium + SwiftShader (只有 CPU) 渲染，倉庫在 /home/user/- 。
> 先仔細閱讀：docs/SCREENPLAY.md、docs/STYLE.md (嚴格遵守)、docs/SCENE_API.md (含 TextField 用法與 overlay 交接點)、docs/PLAN.md 的「踩過的坑」、film/timeline.json、film/src/look/ 與 film/src/lib/ (尤其 flines.js、linemorph.js、edgebox.js、look/text.js)、film/src/scenes/_stub.js。
> 視覺：數據流 × 文物。像一本會動的文物圖錄，用資料視覺化的精度呈現。黑底，紙白色的光，人的暖色 (PAL.c)，AI 的冷色 (PAL.si)，火是 PAL.hot。考據要真實，不要噪點、閃爍或彩虹色。
> 你的任務：〔鏡頭、時間、每秒的內容、字卡位置〕。
> 流程：`node tools/render.mjs shot <id> --step 2` 看半解析度接觸表；`node tools/render.mjs stills --times ... --scale 1 --samples 6` 看最終品質與耗時。**為了節省額度：最多 6 輪迭代，每輪只讀 1 張接觸表 + 至多 2 張全解析度裁切。**
> 規則：只改你自己的場景檔與新的 lib 檔；不要改 engine/post/overlay/main/timeline/look；不要 git commit。交回：每段畫面描述、全解析度耗時、最佳接觸表路徑、需要的引擎改動。

## 5. 驗收標準
- 觀眾第一次看就能說出：「有人問 AI 媽媽會不會好；AI 說它不知道，但人類三千年來都在這樣問；每個問題背後都是愛；最後她開始講媽媽。」
- 每個時代的數據質地一眼可辨，且都有考據。
- 全片只有暖、冷兩種飽和色。
- 音畫同步誤差小於 1 幀 (鍵盤聲、裂紋聲 105.5、lift 鈴聲、片名裂紋 246.5)。
