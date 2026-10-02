#!/usr/bin/env bash
# Downloads the open-source (OFL) fonts used by the overlay into film/assets/fonts/.
set -e
cd "$(dirname "$0")/../film/assets/fonts"
B=https://raw.githubusercontent.com/google/fonts/main/ofl
get(){ [ -s "$2" ] || curl -fsSL -o "$2" "$B/$1"; echo "ok $2"; }
get "notoseriftc/NotoSerifTC%5Bwght%5D.ttf" NotoSerifTC.ttf
get "notosanstc/NotoSansTC%5Bwght%5D.ttf" NotoSansTC.ttf
get "cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf" CormorantGaramond.ttf
get "cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf" CormorantGaramond-Italic.ttf
get "jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf" JetBrainsMono.ttf
get "cinzel/Cinzel%5Bwght%5D.ttf" Cinzel.ttf
