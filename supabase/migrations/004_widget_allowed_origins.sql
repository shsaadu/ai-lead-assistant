-- Migration 004: which websites may embed each business's chat widget.
--
-- A list of origins like {'https://www.thames-english.co.uk'}. Empty (the
-- default) means any website may use the widget — fine for demos; set it for
-- real clients so their assistant can't be put on someone else's site.
-- Editable in the admin dashboard under Settings → Website embed.
--
-- Run this ONCE in Supabase (SQL Editor → New query → paste → Run). Fresh
-- installs don't need it — schema.sql already includes this column.

alter table businesses add column if not exists allowed_origins text[] default '{}';
