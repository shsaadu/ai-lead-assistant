# AI Lead Assistant for Service Businesses

A reusable AI website assistant: a chat widget that answers customer questions from a business's own FAQs/documents (RAG), captures qualified leads (name, email, service needed, budget), hands off to a human when it's unsure, and gives the business owner an admin dashboard to see it all.

Demo business: **Northstar Plumbing** (fictional UK plumbing company) — but every part of the business's identity (name, tagline, brand colour, knowledge base, system instructions, notification email) is configuration, not hardcoded, so this can be reused for any client.

## What it includes

- **Website chat widget** — answers questions, recognises high-intent messages ("I have a leak", "get a quote"), and opens a lead form at the right moment
- **RAG-based FAQ answers** — documents added via the admin dashboard are chunked, embedded (`gemini-embedding-001`), and retrieved via Postgres vector search (`pgvector`) for every question
- **Lead capture** — name, email, service needed, budget, and message, saved to a real database
- **Admin dashboard** — leads table (with status tracking), full conversation history, knowledge-base management (add/remove documents), and business settings — all behind a password-protected login
- **Human hand-off** — when the assistant isn't confident in an answer, it says so, and the conversation is flagged in the admin dashboard as needing follow-up
- **Configurable branding** — business name, tagline, and brand colour are set from the admin dashboard and applied live on the website
- **Email notification** — the business owner gets an email (via Resend) the moment a new lead comes in

## Architecture

```
ai-lead-assistant/
├── index.html, admin.html      → customer-facing site + admin dashboard
├── css/, js/                   → styling + frontend logic
├── api/chat.js                 → RAG-powered chat (retrieval + generation + persistence)
├── api/leads.js                → lead capture + email notification
├── api/config.js               → public branding config for the widget
├── api/admin/*.js              → password-protected: leads, conversations, documents, settings
├── api/_lib/*.js                → shared Supabase/Gemini/chunking/auth helpers
├── supabase/schema.sql          → full database schema (run once in Supabase)
└── vercel.json
```

**Data flow for a question:** widget → `/api/chat` → embed the question → `match_chunks()` (pgvector similarity search, scoped to this business) → Gemini generates an answer grounded in the retrieved chunks → message history saved → response includes whether a lead form should open.

**Data flow for a lead:** lead form → `/api/leads` → saved to Supabase → email sent via Resend to the business's `notify_email` → shows up instantly in the admin dashboard.

## 1. Set up Supabase (free, no card required)

1. Go to [supabase.com](https://supabase.com) → New project
2. Once created, go to the **SQL Editor** → paste the entire contents of `supabase/schema.sql` → Run
   - This creates all tables, enables `pgvector`, creates the similarity-search function, and seeds the demo business (Northstar Plumbing)
3. Go to **Project Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (not the anon key — this needs write access) → `SUPABASE_SERVICE_ROLE_KEY`

## 2. Set up Resend (free, no card required)

1. Go to [resend.com](https://resend.com) → sign up
2. **API Keys** → Create API Key → copy it → `RESEND_API_KEY`
3. Without verifying your own domain, Resend's default sender (`onboarding@resend.dev`) can only send to the email you signed up with — fine for testing. Verify your own domain in Resend later if you want to send to arbitrary client inboxes.

## 3. Get a Gemini API key (free, no card required)

Same as previous projects — [aistudio.google.com](https://aistudio.google.com) → Get API key.

## 4. Deploy to Vercel

1. Push this repo to GitHub, import it in Vercel
2. Add these environment variables (**Project → Settings → Environment Variables**):
   ```
   GEMINI_API_KEY=...
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   RESEND_API_KEY=...
   RESEND_FROM_EMAIL=AI Lead Assistant <onboarding@resend.dev>
   ADMIN_PASSWORD=choose_your_own_password
   ```
3. Deploy
4. In Supabase's SQL editor, run: `update businesses set notify_email = 'your-email@example.com' where slug = 'northstar-plumbing';` so lead emails actually go somewhere
5. Visit `/admin.html` on your deployed site and log in with your `ADMIN_PASSWORD`

## 5. Add your first knowledge-base document

In the admin dashboard → **Knowledge base** tab → paste in FAQs, pricing info, or service details → Add & index. Ask the chat widget a question that only that document would answer, to confirm retrieval is working.

## Reusing this for a real client

1. In Supabase, insert a new row into `businesses` with a new `slug` (e.g. `acme-cleaning`), their own `system_prompt`, `services`, `brand_color`, and `notify_email`
2. Either deploy a separate copy of this repo per client (simplest), or extend `index.html`/`admin.html` to read `?business=acme-cleaning` from the URL and pass it through to every API call (the backend already supports multiple businesses via the `business` parameter — only the frontend currently hardcodes `northstar-plumbing`)
3. Update the branding text/colours in `index.html` to match, or rely on `/api/config` once you wire up dynamic business selection

## Notes for going from demo to a real client

- `ADMIN_PASSWORD` auth is intentionally simple (one shared password) — fine for a single business owner, not meant for multiple staff accounts. A real multi-user version would need proper auth (e.g. Supabase Auth).
- The Resend "5,000 free grounded prompts" style deals don't apply here — email sending on Resend's free tier is 3,000 emails/month, no separate cost per lead.
- Consider adding basic rate-limiting on `/api/chat` and `/api/leads` before pointing this at real public traffic, to avoid abuse racking up Gemini API usage.
