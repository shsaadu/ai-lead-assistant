-- Migration 003: conversation insights from the assistant.
--
-- On every reply the assistant reports the visitor's language, how ready they
-- are to act (intent), and a short English summary of what they want. These
-- are shown in the admin dashboard so staff can triage chats at a glance.
--
-- Run this ONCE in Supabase (SQL Editor → New query → paste → Run). Fresh
-- installs don't need it — schema.sql already includes these columns.

alter table conversations add column if not exists language text;
alter table conversations add column if not exists intent text
  check (intent in ('ready', 'researching', 'other'));
alter table conversations add column if not exists summary text;
