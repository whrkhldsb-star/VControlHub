-- A built-in quick service's link is its host and port followed by its path. Most catalog paths were
-- reverse-proxy aliases ("/nextcloud/", "/fb/", "/jellyfin/"), which the apps do not serve on their own port,
-- so "Open" led to a "Not found" page. The catalog now names each app's own page ("/" for these; Emby,
-- Pi-hole and Ghost keep theirs). Installed services that still carry the old alias get the same; a path
-- someone changed is left as it is.
UPDATE "quick_services" AS service
SET "path" = '/'
FROM (VALUES
    ('halo', '/halo/'),
    ('wordpress', '/wordpress/'),
    ('typecho', '/typecho/'),
    ('gitea', '/gitea/'),
    ('code-server', '/code-server/'),
    ('vaultwarden', '/vaultwarden/'),
    ('portainer', '/portainer/'),
    ('stirling-pdf', '/stirling-pdf/'),
    ('it-tools', '/it-tools/'),
    ('n8n', '/n8n/'),
    ('gladys', '/gladys/'),
    ('jellyfin', '/jellyfin/'),
    ('navidrome', '/navidrome/'),
    ('photoprism', '/photoprism/'),
    ('immich', '/immich/'),
    ('metube', '/metube/'),
    ('komga', '/komga/'),
    ('uptime-kuma', '/uptime-kuma/'),
    ('adguardhome', '/adguard/'),
    ('speedtest-tracker', '/speedtest/'),
    ('beszel', '/beszel/'),
    ('changedetection', '/changedetection/'),
    ('memos', '/memos/'),
    ('outline', '/outline/'),
    ('hedgedoc', '/hedgedoc/'),
    ('affine', '/affine/'),
    ('linkwarden', '/linkwarden/'),
    ('wallabag', '/wallabag/'),
    ('dufs', '/dufs/'),
    ('pairdrop', '/pairdrop/'),
    ('tianji', '/tianji/'),
    ('lobe-chat', '/lobe-chat/'),
    ('frps', '/frps/'),
    ('maxtext', '/maxkb/'),
    ('alist', '/files-proxy/'),
    ('nextcloud', '/nextcloud/'),
    ('filebrowser', '/fb/'),
    ('minio', '/minio/'),
    ('davos', '/davos/')
) AS legacy (slug, path)
WHERE service."slug" = legacy.slug AND service."path" = legacy.path;
