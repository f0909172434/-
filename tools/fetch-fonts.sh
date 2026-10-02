#!/usr/bin/env bash
# Downloads the open-source (OFL) fonts used by the overlay and the text field into film/assets/fonts/.
set -e
cd "$(dirname "$0")/../film/assets/fonts"
B=https://raw.githubusercontent.com/google/fonts/main/ofl
get(){ [ -s "$2" ] || curl -fsSL --retry 4 -o "$2" "$B/$1"; echo "ok $2"; }
# overlay (UI) faces
get "notoseriftc/NotoSerifTC%5Bwght%5D.ttf" NotoSerifTC.ttf
get "notosanstc/NotoSansTC%5Bwght%5D.ttf" NotoSansTC.ttf
get "cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf" CormorantGaramond.ttf
get "cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf" CormorantGaramond-Italic.ttf
get "jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf" JetBrainsMono.ttf
get "cinzel/Cinzel%5Bwght%5D.ttf" Cinzel.ttf
# the river of questions: one Noto face per script
get "notosans/NotoSans%5Bwdth,wght%5D.ttf" NotoSans.ttf
get "notosansjp/NotoSansJP%5Bwght%5D.ttf" NotoSansJP.ttf
get "notosanskr/NotoSansKR%5Bwght%5D.ttf" NotoSansKR.ttf
get "notosansarabic/NotoSansArabic%5Bwdth,wght%5D.ttf" NotoSansArabic.ttf
get "notosanshebrew/NotoSansHebrew%5Bwdth,wght%5D.ttf" NotoSansHebrew.ttf
get "notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf" NotoSansDevanagari.ttf
get "notosansthai/NotoSansThai%5Bwdth,wght%5D.ttf" NotoSansThai.ttf
# era materials: typewriter / telegram, copperplate letters, brush handwriting, 1703 print
get "courierprime/CourierPrime-Regular.ttf" CourierPrime.ttf
get "pinyonscript/PinyonScript-Regular.ttf" PinyonScript.ttf
get "lxgwwenkaitc/LXGWWenKaiTC-Light.ttf" LXGWWenKaiTC-Light.ttf
get "lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf" LXGWWenKaiTC-Regular.ttf
get "ebgaramond/EBGaramond%5Bwght%5D.ttf" EBGaramond.ttf
