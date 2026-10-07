-- Migration 006: assistant personality and look.
--   assistant_name   — optional name, e.g. "Lumi"; shown in the chat header and
--                      greeting, and the assistant introduces itself by it
--   assistant_avatar — "lamp" (built-in street lamp), an https:// image URL,
--                      or empty for none
--   widget_theme     — "light" (default) or "dark"
--
-- Run this ONCE in Supabase (SQL Editor → New query → paste → Run). Fresh
-- installs don't need it — schema.sql already includes these columns.

alter table businesses add column if not exists assistant_name text;
alter table businesses add column if not exists assistant_avatar text;
alter table businesses add column if not exists widget_theme text default 'light';
