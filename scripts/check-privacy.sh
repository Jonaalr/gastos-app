#!/usr/bin/env bash
# check-privacy.sh — Bloquea un commit si los archivos a subir contienen datos personales.
#
# 1) Patrones genéricos: números de tarjeta, CLABE, RFC, correos.
# 2) Tus datos específicos (nombre, números de cliente, etc.) viven en un archivo
#    FUERA del repositorio: ~/.config/gastos/privacy-terms.txt (o la ruta en GASTOS_PRIVACY_TERMS).
#    Una palabra o frase por línea. Las líneas que empiezan con # se ignoran.
#
# Solo revisa las líneas nuevas del commit (lo que se está agregando), no el historial.

set -u

TERMS="${GASTOS_PRIVACY_TERMS:-$HOME/.config/gastos/privacy-terms.txt}"
RULES=(
  'tarjeta de 16 dígitos|\b([0-9]{4}[ -]?){3}[0-9]{4}\b'
  'CLABE de 18 dígitos|\b[0-9]{18}\b'
  'RFC|\b[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}\b'
  'correo electrónico|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
)

failed=0
tmp_terms=""
if [ -f "$TERMS" ]; then
  tmp_terms="$(mktemp)"
  grep -v '^[[:space:]]*#' "$TERMS" | grep -v '^[[:space:]]*$' > "$tmp_terms"
else
  echo "aviso: no encontré la lista privada en $TERMS; solo se revisan patrones genéricos." >&2
fi

while IFS= read -r file; do
  [ -z "$file" ] && continue
  # Ignora archivos binarios (imágenes, PDF, etc.)
  if ! git show ":$file" 2>/dev/null | grep -Iq .; then continue; fi

  # Solo las líneas que se agregan en este commit
  added="$(git diff --cached -U0 --no-color -- "$file" | grep '^+' | grep -v '^+++' | sed 's/^+//')"
  [ -z "$added" ] && continue

  for rule in "${RULES[@]}"; do
    name="${rule%%|*}"; re="${rule#*|}"
    lines="$(printf '%s\n' "$added" | grep -nE "$re" | cut -d: -f1 | tr '\n' ' ')"
    if [ -n "$lines" ]; then
      echo "BLOQUEADO: $file — posible $name (líneas nuevas: $lines)" >&2
      failed=1
    fi
  done

  if [ -n "$tmp_terms" ] && [ -s "$tmp_terms" ]; then
    hits="$(printf '%s\n' "$added" | grep -niF -f "$tmp_terms" | cut -d: -f1 | tr '\n' ' ')"
    if [ -n "$hits" ]; then
      echo "BLOQUEADO: $file — contiene un dato de tu lista privada (líneas nuevas: $hits)" >&2
      failed=1
    fi
  fi
done < <(git diff --cached --name-only --diff-filter=ACM)

[ -n "$tmp_terms" ] && rm -f "$tmp_terms"

if [ "$failed" -eq 1 ]; then
  echo "" >&2
  echo "El commit se canceló para proteger tus datos. Quita esos datos del archivo y vuelve a intentar." >&2
  exit 1
fi
exit 0
