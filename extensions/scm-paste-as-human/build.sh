#!/usr/bin/env bash
# Empaqueta la extensión en un .zip listo para distribuir.
# Uso: bash build.sh

set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(node -e "console.log(require('./manifest.json').version)")
OUT_DIR="release"
ZIP_NAME="scm-paste-as-human-v${VERSION}.zip"

mkdir -p "${OUT_DIR}"
rm -f "${OUT_DIR}/${ZIP_NAME}"

# Lista explícita de archivos a empaquetar — evita meter accidentalmente
# archivos de dev (TESTING.md, SMOKE-TEST.md, build.sh, release/, .git, etc.)
FILES=(
  "manifest.json"
  "content.js"
  "lib/clipboard.js"
  "lib/badge.js"
  "lib/toast.js"
  "lib/cancel.js"
  "lib/typing.js"
  "README.md"
)

# Verificar que existan
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: falta archivo $f" >&2
    exit 1
  fi
done

# Empaquetar
if command -v zip >/dev/null 2>&1; then
  zip -r "${OUT_DIR}/${ZIP_NAME}" "${FILES[@]}" >/dev/null
else
  # Fallback: usar PowerShell Compress-Archive en Windows
  powershell -Command "Compress-Archive -Path $(IFS=,; echo "${FILES[*]}") -DestinationPath '${OUT_DIR}/${ZIP_NAME}' -Force"
fi

SIZE=$(du -h "${OUT_DIR}/${ZIP_NAME}" | cut -f1)
echo "✓ ${OUT_DIR}/${ZIP_NAME} (${SIZE})"
echo ""
echo "Para distribuir:"
echo "  1. Pasar el zip al setter"
echo "  2. Que lo descomprima en una carpeta"
echo "  3. chrome://extensions/ → Modo dev → drag-drop de la carpeta"
