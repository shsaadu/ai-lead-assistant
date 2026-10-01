-- Migration 005: per-business lead questions, and phone/WhatsApp as an
-- alternative to email.
--
-- businesses.lead_fields lists extra questions for the lead form, e.g.
--   [{"key":"course","label":"Which course?","type":"select",
--     "options":["General English","IELTS Preparation"]},
--    {"key":"start_date","label":{"en":"Start date","es":"Fecha de inicio"},"type":"text"}]
-- `label` is a string, or an object of translations keyed by language code.
-- Answers are stored in leads.details as {"course":"General English", ...}.
--
-- Run this ONCE in Supabase (SQL Editor → New query → paste → Run). Fresh
-- installs don't need it — schema.sql already includes these changes.

alter table businesses add column if not exists lead_fields jsonb default '[]'::jsonb;

alter table leads add column if not exists phone text;
alter table leads add column if not exists details jsonb default '{}'::jsonb;
-- Students often prefer WhatsApp to email: a lead needs an email OR a phone.
alter table leads alter column email drop not null;
alter table leads drop constraint if exists leads_contact_required;
alter table leads add constraint leads_contact_required check (email is not null or phone is not null);
