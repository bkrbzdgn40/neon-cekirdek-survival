#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm install --no-save --no-package-lock --ignore-scripts --no-audit --no-fund tailwindcss@3.4.17 @fortawesome/fontawesome-free@6.5.1 @fontsource/orbitron@5.2.8 @fontsource/rajdhani@5.2.7
./node_modules/.bin/tailwindcss -c tailwind.config.cjs -i src/tailwind.input.css -o src/utilities.css --minify
mkdir -p src/vendor/fontawesome/css src/vendor/fontawesome/webfonts src/vendor/fonts
cp node_modules/@fortawesome/fontawesome-free/css/all.min.css src/vendor/fontawesome/css/all.min.css
cp node_modules/@fortawesome/fontawesome-free/webfonts/*.woff2 src/vendor/fontawesome/webfonts/
cp node_modules/@fortawesome/fontawesome-free/LICENSE.txt src/vendor/fontawesome/LICENSE.txt
for weight in 400 600 700 900; do cp "node_modules/@fontsource/orbitron/files/orbitron-latin-${weight}-normal.woff2" src/vendor/fonts/; done
for weight in 500 600 700; do cp "node_modules/@fontsource/rajdhani/files/rajdhani-latin-${weight}-normal.woff2" src/vendor/fonts/; done
