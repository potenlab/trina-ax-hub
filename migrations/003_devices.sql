-- Devices remember who made their enrollment code and which hub address they were set up with.
--   created_by   who made the enroll code (null = the CLI on the hub)
--   approved_at  when the person themselves accepted the device. A device someone else (an admin) enrolled for them
--                cannot open their personal folder users/<id>/ until they approve it on their page.
--   hub_url      the hub address written into that PC's settings (to warn when the hub address changes)
ALTER TABLE tokens ADD COLUMN created_by TEXT;
ALTER TABLE tokens ADD COLUMN approved_at TEXT;
ALTER TABLE tokens ADD COLUMN hub_url TEXT;
-- devices that existed before this change were set up the old way: treat them as approved
UPDATE tokens SET approved_at = created_at WHERE kind = 'device' AND approved_at IS NULL;
