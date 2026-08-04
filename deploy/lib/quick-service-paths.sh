#!/usr/bin/env bash
# Shared host-path inventory for Quick Service installation and full removal.

quick_service_host_paths() {
  cat <<'EOF'
/opt/adguardhome/conf
/opt/adguardhome/work
/opt/affine/data
/opt/alist/data
/opt/beszel/data
/opt/changedetection/data
/opt/code-server/config
/opt/davos/config
/opt/davos/downloads
/opt/dufs/data
/opt/emby/config
/opt/emby/data
/opt/filebrowser/config
/opt/filebrowser/db
/opt/frps/config
/opt/ghost/content
/opt/gitea/data
/opt/gladys/data
/opt/halo/data
/opt/hedgedoc/uploads
/opt/immich/upload
/opt/jellyfin/cache
/opt/jellyfin/config
/opt/jellyfin/media
/opt/komga/books
/opt/komga/config
/opt/linkwarden/data
/opt/maxkb/data
/opt/memos/data
/opt/metube/downloads
/opt/minio/data
/opt/n8n/data
/opt/navidrome/data
/opt/navidrome/music
/opt/nextcloud/data
/opt/nextcloud/html
/opt/outline/data
/opt/photoprism/originals
/opt/photoprism/storage
/opt/pihole/etc-dnsmasq
/opt/pihole/etc-pihole
/opt/portainer/data
/opt/speedtest/config
/opt/stirling-pdf/data
/opt/tianji/data
/opt/typecho/data
/opt/uptime-kuma/data
/opt/vaultwarden/data
/opt/wallabag/data
/opt/wallabag/images
/opt/wordpress/data
/srv
EOF
}

quick_service_removable_data_paths() {
  local path
  while IFS= read -r path; do
    case "${path}" in
      /opt/*/*|/srv/*/*) printf '%s\n' "${path}" ;;
    esac
  done <<EOF
$(quick_service_host_paths)
EOF
}
