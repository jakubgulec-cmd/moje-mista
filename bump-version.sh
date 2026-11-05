#!/bin/sh
# Nové číslo verze pro všechny soubory aplikace (aby se nesmíchala stará a nová verze).
cd "$(dirname "$0")/docs" || exit 1
V=$(date +%Y%m%d%H%M)
sed -i -E "s/(manifest\.webmanifest|styles\.css|config\.js|app\.js)\?v=[0-9]+/\1?v=$V/g" index.html
sed -i -E "s#from \"\./(glass|routing)\.js(\?v=[0-9]+)?\"#from \"./\1.js?v=$V\"#g" app.js
sed -i -E "s/const CACHE = \"mm-[0-9]+\";/const CACHE = \"mm-$V\";/" sw.js
echo "verze $V"
