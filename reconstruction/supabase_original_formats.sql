UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/gif','image/heic','image/heif','application/octet-stream']
WHERE id='if-shared-originals';