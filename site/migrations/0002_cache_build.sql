-- The HTML cache also remembers which deploy rendered a page, so a new deploy (new templates) never serves pages
-- rendered by the previous one.
ALTER TABLE html_cache ADD COLUMN build TEXT NOT NULL DEFAULT '';
