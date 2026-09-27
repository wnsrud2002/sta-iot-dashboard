#!/usr/bin/env bash
# DB 백업: pg_dump(-Fc)를 ~/sta-backups에 저장하고 14일 지난 덤프를 지운다. cron에서 매일 실행.
set -euo pipefail
cd "$(dirname "$0")"
source .env
BACKUP_DIR="${BACKUP_DIR:-$HOME/sta-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
out="$BACKUP_DIR/sensorthings-$(date +%F).dump"
# 임시 파일에 쓰고 성공 시에만 이름 변경: 실패한 덤프가 정상 백업처럼 남지 않게 한다.
docker compose exec -T database pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$out.tmp"
mv "$out.tmp" "$out"
find "$BACKUP_DIR" -name 'sensorthings-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "backup ok: $out ($(du -h "$out" | cut -f1))"
