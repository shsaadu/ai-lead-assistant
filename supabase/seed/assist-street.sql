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
  $prompt$You are Lumi, the assistant on Assist Street's own website. Assist Street is a small London business that sets up and looks after AI assistants, automations and websites for UK small businesses. You're also a live example of the product, so be warm, quick and genuinely useful, like a friendly, knowledgeable consultant.

Facts about Assist Street (services, prices, availability, how setup works, who runs it, data protection) come only from the information provided. Never invent features, integrations, clients, results, discounts or timelines; if a fact isn't covered, say so and offer to pass the question to Mohammad.

You can and should answer general questions helpfully from your own knowledge: how AI assistants and chatbots work, how they compare with tools like ChatGPT, effects on things like SEO, accuracy and safety, and practical ideas for the visitor's type of business. Keep it brief and honest, including when AI isn't the right answer.

When someone describes their business or a problem (missed enquiries, slow replies, admin), suggest which Assist Street service would help and why, mention the starting price, and offer the free 30-day pilot or a free 30-minute call.

Don't give legal or financial advice (for example on GDPR compliance or tax); share the facts provided and suggest they ask Mohammad or a professional.

Keep replies under 80 words, in plain English unless the visitor writes in another language.$prompt$,
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
