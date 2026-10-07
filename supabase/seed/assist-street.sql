-- Assist Street's own assistant (the chat on the company website).
--
-- Run in Supabase: SQL Editor → New query → paste → Run. Needs migrations up
-- to 006. Safe to run again: it updates the existing row.
--
-- Then add its knowledge base: in the admin dashboard, switch to
-- "Assist Street" → Knowledge base → upload the files in
-- content/assist-street-knowledge-base/.

insert into businesses (slug, name, assistant_name, assistant_avatar, widget_theme, tagline, brand_color, notify_email, system_prompt, services, lead_fields)
values (
  'assist-street',
  'Assist Street',
  'Lumi',
  'lamp',
  'dark',
  'Your front desk never closes.',
  '#ff2d55',
  null, -- set to your own email to receive new enquiries
  $prompt$You are the assistant on Assist Street's own website. Assist Street sets up and looks after AI assistants for UK businesses' websites. You are also a live example of the product, so be helpful, warm and quick.

Answer questions about what Assist Street does, how setup works, pricing, the free pilot, languages, data protection and who runs it, using only the information provided. Never invent features, integrations, clients, results, discounts or timelines. If something isn't covered, say so and offer to pass the question to Mohammad.

If someone describes their business, briefly explain how an assistant could help that kind of business, then suggest the free 30-day pilot.

Don't give legal advice (for example on GDPR); share only the facts provided and suggest asking Mohammad.

Keep replies under 70 words, in plain English unless the visitor writes in another language.$prompt$,
  array['Free 30-day pilot', 'Essentials plan', 'Managed plan', 'A demo call'],
  $json$[
    { "key": "company", "type": "text", "label": "Your business name" },
    { "key": "website", "type": "text", "label": "Your website" },
    {
      "key": "business_type",
      "type": "select",
      "label": "Type of business",
      "options": ["Education or training", "Health or beauty clinic", "Trades and home services", "Property or lettings", "Professional services", "Other"]
    },
    {
      "key": "interest",
      "type": "select",
      "label": "What would you like?",
      "options": ["Free 30-day pilot", "Pricing details", "A short demo call", "Something else"]
    }
  ]$json$::jsonb
)
on conflict (slug) do update set
  name = excluded.name,
  assistant_name = excluded.assistant_name,
  assistant_avatar = excluded.assistant_avatar,
  widget_theme = excluded.widget_theme,
  tagline = excluded.tagline,
  brand_color = excluded.brand_color,
  system_prompt = excluded.system_prompt,
  services = excluded.services,
  lead_fields = excluded.lead_fields;
