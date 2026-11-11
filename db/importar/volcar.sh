#!/usr/bin/env bash
# ============================================================
#  db/importar/volcar.sh — los DATOS del proyecto viejo a la base Neon destino
# ============================================================
#  Solo `public`: el esquema del destino ya lo montan db/0000…db/0003, y las
#  tablas de auth (auth.users / auth.identities) NO se vuelcan — esas las
#  traduce cuentas.mjs, porque en Blink Plans la identidad vive en public.user
#  y public.account.
#
#  Lo que hace, en orden:
#    1) Preflight: lectura pura de los dos lados. Corta si el destino ya tiene
#       filas en alguna tabla que se va a escribir (restaurar encima de datos
#       mezclados no es recuperable).
#    2) pg_dump --data-only de public  →  dumps/viejo-<fecha>.dump  (gitignoreado:
#       un volcado arrastra datos de clientes reales).
#    3) Desactiva los disparadores del DESTINO, restaura, los vuelve a activar.
#    4) compara los dos lados con verificar.sql y sale 1 si algo no cuadra.
#
#  Por qué se desactivan los disparadores a mano y no con la opción de siempre:
#  `pg_restore --disable-triggers` y `SET session_replication_role = replica`
#  necesitan superusuario, y en Neon NO lo hay — medido:
#      SET session_replication_role = replica;
#      ERROR:  permission denied to set parameter "session_replication_role"
#  `ALTER TABLE … DISABLE TRIGGER` sí funciona: lo hace el dueño de la tabla, y
#  el rol de la conexión lo es. Sin esto el volcado NO es un traslado, es una
#  recalculación: trg_cupos_after_insert vuelve a sumar cupos_ocupados sobre el
#  valor histórico (y revienta el CHECK cupos_ocupados <= cupos_totales),
#  trg_comision_referido vuelve a insertar comisiones de años pasados y
#  trg_renovar_susc_por_pago reescribe fechas de vencimiento viejas.
#
#  Medido en el simulacro (db/importar/fixtures/simulacro-viejo.sql → 3
#  suscripciones activas sobre una cuenta madre con cupos_ocupados = 2 de 3):
#  restaurando el MISMO volcado con los disparadores despiertos,
#
#      pg_restore: error: COPY falló para la tabla «suscripciones»:
#                  ERROR:  Cuenta madre sin cupos disponibles (limite 3)
#      pg_restore: error: COPY falló para la tabla «pago_suscripciones»:
#                  ERROR:  ... violates foreign key constraint
#                          "pago_suscripciones_suscripcion_id_fkey"
#      pg_restore: precaución: errores ignorados durante la recuperación: 2
#
#  Dos cosas hay que leer ahí. La primera: el disparador de cupos se suma sobre
#  el valor histórico y revienta, y arrastra a todo lo que cuelga de
#  suscripciones. La segunda, peor: sin --single-transaction pg_restore llama a
#  eso «precaución» y SALE CON 0 — un guion que mida el código de salida da la
#  migración por buena mientras las suscripciones y los pagos no entraron. Por
#  eso este script usa --single-transaction (o se revierte entero) y termina con
#  el diff de verificar.sql, que es lo que realmente prueba que los datos están.
#
#  Uso:
#    VIEJO=postgresql://…  NUEVO=postgresql://…  db/importar/volcar.sh            # informe
#    VIEJO=… NUEVO=… db/importar/volcar.sh --aplicar                              # vuelca de verdad
#  Las cadenas van por entorno, no por argumentos: argv se lee en `ps` y se
#  queda en el historial del shell.
# ============================================================
set -euo pipefail

APLICAR=0
for a in "$@"; do
  case "$a" in
    --aplicar) APLICAR=1 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "opción desconocida: $a (--aplicar | --help)" >&2; exit 2 ;;
  esac
done

: "${VIEJO:?falta VIEJO=cadena de conexión del Supabase viejo}"
: "${NUEVO:?falta NUEVO=cadena de conexión de la base Neon destino}"

cd "$(dirname "$0")/../.." || exit 1
REPO="$(pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$REPO/dumps/viejo-$STAMP.dump"
mkdir -p "$REPO/dumps"
chmod 700 "$REPO/dumps"

psql_v() { psql "$VIEJO" -X -q -v ON_ERROR_STOP=1 -At "$@"; }
psql_n() { psql "$NUEVO" -X -q -v ON_ERROR_STOP=1 -At "$@"; }

# Las tablas de negocio que se trasladan: las que existen en public del destino.
# Se lista desde el catálogo, no a mano, para que una tabla nueva no se quede
# fuera del volcado por olvido.
TABLAS_SQL="
  select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r','p')
     and c.relpersistence = 'p'
   order by 1;"

echo "── 1/4 preflight ────────────────────────────────────────────"
TABLAS_VIEJO="$(psql_v -c "$TABLAS_SQL")" || { echo "no se puede leer el viejo" >&2; exit 1; }
TABLAS_NUEVO="$(psql_n -c "$TABLAS_SQL")" || { echo "no se puede leer el destino" >&2; exit 1; }
echo "   servidor viejo : $(psql_v -c 'select version();' | cut -d' ' -f1-3)"
echo "   servidor nuevo : $(psql_n -c 'select version();' | cut -d' ' -f1-3)"
echo "   tablas en public: $(wc -l <<<"$TABLAS_VIEJO") origen / $(wc -l <<<"$TABLAS_NUEVO") destino"

# Toda tabla de public del destino con filas corta la operación: mezclar
# histórico restaurado con filas nuevas no tiene vuelta. Se comprueba del todo,
# no solo sobre las tablas que trae el origen, y desde un bloque DO para que el
# nombre de cada tabla lo cite el servidor — escaparlo desde la shell es donde
# se cuelan los `\"` que rompen el SQL.
ERR="$(mktemp)"
if ! psql_n -c "
do \$\$
declare
    r record;
    n bigint;
    lista text := '';
begin
    for r in
        select c.relname
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r','p')
           and c.relpersistence = 'p'
         order by 1
    loop
        execute format('select count(*) from %I.%I', 'public', r.relname) into n;
        if n > 0 then
            lista := lista || ' ' || r.relname || '=' || n;
        end if;
    end loop;
    if lista <> '' then
        raise exception 'el destino ya tiene filas:%', lista
          using hint = 'vacíalo o usa otra base: restaurar encima mezcla dos historias.';
    end if;
end
\$\$;" > /dev/null 2>"$ERR"; then
  sed -n 's/^ERROR:  /   ✗ /p;/^HINT:/s/^HINT:  /     /p' "$ERR" >&2
  rm -f "$ERR"
  exit 1
fi
rm -f "$ERR"
echo "   ✓ destino vacío ($(wc -l <<<"$TABLAS_NUEVO") tablas de public, incluidas $(wc -l <<<"$TABLAS_VIEJO") que se van a escribir)"

echo "── 2/4 volcado (solo datos de public) ───────────────────────"
pg_dump "$VIEJO" --schema=public --data-only --no-owner --no-privileges \
        --no-tablespaces -Fc -f "$DUMP"
chmod 600 "$DUMP"
echo "   ✓ $DUMP ($(du -h "$DUMP" | cut -f1))"

if [ "$APLICAR" -ne 1 ]; then
  echo
  echo "informe: se dejó el volcado en $DUMP y NO se restauró nada."
  echo "revisa el conteo del origen y repite con --aplicar."
  psql_v -f db/importar/verificar.sql | sed 's/^/   /'
  exit 0
fi

echo "── 3/4 restauración con los disparadores del destino dormidos ─"
# Lista viva: cualquier disparador de usuario de public, presente o futuro.
# Los de restricción (RI) son internos y NO entran en la lista: ver abajo.
DISABLES="$(psql_n -c "
  select string_agg(
           format('alter table %s disable trigger %I;',
                  pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname),
                  t.tgname), E'\n')
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal;")"
[ -n "$DISABLES" ] && psql_n -c "$DISABLES"
echo "   $(grep -c . <<<"$DISABLES") disparadores desactivados"

# Se vuelven a activar SIEMPRE, aunque la restauración falle.
reactivar() {
  local r
  r="$(psql_n -c "
    select string_agg(
             format('alter table %s enable trigger %I;',
                    pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname),
                    t.tgname), E'\n')
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal;" 2>/dev/null || true)"
  [ -n "$r" ] && psql_n -c "$r" 2>/dev/null || true
  echo "   ✓ disparadores reactivados"
}
trap reactivar EXIT

pg_restore -d "$NUEVO" --single-transaction --no-owner --no-privileges --data-only "$DUMP"
echo "   ✓ datos restaurados"

echo "── 4/4 paridad origen ↔ destino ─────────────────────────────"
# Las cuatro tablas de Better Auth (user / account / session / verification) no
# las toca este script: las escribe cuentas.mjs. En el diff se excluyen de las
# dos listas — en el origen ni siquiera existen.
FUERA='^(account|session|user|verification)\|'
A="$(mktemp)" B="$(mktemp)" D="$(mktemp)"
psql_v -f db/importar/verificar.sql | grep -vE "$FUERA" | sort > "$A"
psql_n -f db/importar/verificar.sql | grep -vE "$FUERA" | sort > "$B"
if diff -u "$A" "$B" > "$D"; then
  echo "   ✓ idénticas filas, ids y sumas en los dos lados"
  sed 's/^/     /' "$B"
else
  echo "   ✗ diferencias origen ↔ destino (‹ viejo, › nuevo):" >&2
  sed 's/^/     /' "$D" >&2
  rm -f "$A" "$B" "$D"
  exit 1
fi
rm -f "$A" "$B" "$D"
