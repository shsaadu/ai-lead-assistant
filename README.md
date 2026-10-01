# AI Lead Assistant for Service Businesses

A reusable AI website assistant: a chat widget that answers customer questions from a business's own FAQs/documents (RAG), captures qualified leads (name, email, service needed, budget), hands off to a human when it's unsure, and gives the business owner an admin dashboard to see it all.

Demo business: **Northstar Plumbing** (fictional UK plumbing company) — but every part of the business's identity (name, tagline, brand colour, knowledge base, system instructions, notification email) is configuration, not hardcoded, so this can be reused for any client.

## What it includes

- **Embeddable widget** — one `<script>` line puts the assistant on any website (Shadow DOM, so the host site's styles can't break it); each business can restrict which websites may use it
- **Website chat widget** — answers questions in the visitor's own language and opens a lead form at the right moment (without re-offering it on every message)
- **AI intent detection** — on every reply the assistant also reports, as structured JSON, whether the visitor is ready to act, whether a person needs to step in, their language, and a short English summary for staff; works in any language, no keyword lists
- **RAG-based FAQ answers** — documents added via the admin dashboard are chunked, embedded (`gemini-embedding-001`), and retrieved via Postgres vector search (`pgvector`) for every question
- **Lead capture** — name, email, service needed, budget, and message, saved to a real database
- **Admin dashboard** — leads table (with status tracking), full conversation history, knowledge-base management (add/remove documents), and business settings
- **Per-business admin accounts** — each business owner logs in with their own email and password and only ever sees their own business; a superadmin account can switch between all businesses
- **Rate limiting** — per-visitor and per-business daily chat limits, plus login and lead-form limits, so bots can't burn through the AI quota
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
├── api/_lib/*.js                → shared Supabase/Gemini/chunking/auth/rate-limit helpers
├── supabase/schema.sql          → full database schema (run once in Supabase)
├── supabase/migrations/         → upgrades for projects created with an older schema.sql
├── scripts/create_admin.py      → creates admin accounts (prints SQL to paste into Supabase)
└── vercel.json
```

**Data flow for a question:** widget → `/api/chat` → rate-limit check → embed the question → `match_chunks()` (pgvector similarity search, scoped to this business, ignoring chunks below a relevance threshold) → Gemini generates an answer grounded in the retrieved chunks → message history saved → response includes whether a lead form should open.

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
   SESSION_SECRET=a_long_random_string
   ```
   Generate `SESSION_SECRET` with `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.
3. Deploy
4. In Supabase's SQL editor, run: `update businesses set notify_email = 'your-email@example.com' where slug = 'northstar-plumbing';` so lead emails actually go somewhere
5. Create your admin account (see below), then visit `/admin.html` on your deployed site and sign in

## Admin accounts

Accounts live in the `admin_users` table. Create them with the included script — it only uses Python's standard library, asks for the password without echoing it, and prints a SQL statement to paste into Supabase's SQL editor (no database keys needed):

```bash
# Your own account — can see and switch between every business
python3 scripts/create_admin.py --email you@example.com --name Saad --role superadmin

# A client's account — can only see their own business
python3 scripts/create_admin.py --email owner@client.co.uk --name Jane --business northstar-plumbing
```

Running it again for the same email resets that account's password.

### Upgrading an existing deployment

If your Supabase project was set up with an older `schema.sql`, run the files in `supabase/migrations/` that you haven't run yet, in number order, once each in the SQL editor:

- `002_multi_tenant.sql` — per-business admin accounts, rate limiting, relevance threshold. Then add `SESSION_SECRET` in Vercel, remove `ADMIN_PASSWORD`, redeploy, and create your admin account as above.
- `003_conversation_insights.sql` — stores each conversation's language, intent and summary for the dashboard. The chat keeps working without it; the dashboard just won't show those details.
- `004_widget_allowed_origins.sql` — lets each business restrict which websites can embed its widget. Without it, any website can use the widget.
- `005_lead_questions.sql` — per-business lead-form questions (e.g. course, start date) and phone/WhatsApp as an alternative to email.

## Demo: Thames English Academy (fictional language school)

A ready-made sales demo for language schools:

1. Run `supabase/migrations/005_lead_questions.sql`, then `supabase/seed/thames-english-academy.sql`, in the Supabase SQL editor.
2. In the dashboard, switch to **Thames English Academy** → **Knowledge base** → upload every file in `demo/thames-english-academy/knowledge-base/` at once.
3. Open `/demo/thames-english-academy/` — a school website with the widget on it. Try questions in different languages: the replies, the widget's buttons and the lead form follow the visitor's language (right-to-left for Arabic), and the lead form asks the school's own questions (course, start date, level, accommodation, nationality) with email or WhatsApp.

## Putting the assistant on a client's website

Add one line just before `</body>` on their site (the dashboard's **Settings → Website embed** shows it ready to copy, with the right business slug):

```html
<script src="https://YOUR-DEPLOYMENT.vercel.app/widget.js" data-business="their-business-slug" async></script>
```

Optional attributes: `data-position="left"`, `data-greeting="…"` (first message), `data-label="…"` (button text).

For real clients, list their website(s) under **Allowed websites** so nobody else can embed their assistant. `/embed-test.html?business=<slug>` is a deliberately plain page for checking the widget outside the demo site.

## 5. Add your first knowledge-base document

In the admin dashboard → **Knowledge base** tab → paste in FAQs, pricing info, or service details → Add & index. Ask the chat widget a question that only that document would answer, to confirm retrieval is working.

## Reusing this for a real client

1. In Supabase, insert a new row into `businesses` with a new `slug` (e.g. `acme-cleaning`), their own `system_prompt`, `services`, `brand_color`, and `notify_email`
2. Either deploy a separate copy of this repo per client (simplest), or extend `index.html`/`admin.html` to read `?business=acme-cleaning` from the URL and pass it through to every API call (the backend already supports multiple businesses via the `business` parameter — only the frontend currently hardcodes `northstar-plumbing`)
3. Update the branding text/colours in `index.html` to match, or rely on `/api/config` once you wire up dynamic business selection

## Notes for going from demo to a real client

- Admin auth has no self-service password reset or email verification yet — accounts are created and reset with `scripts/create_admin.py`.
- Email sending on Resend's free tier is 3,000 emails/month, no separate cost per lead.
- Rate limits default to 15 chat messages per visitor per minute and 500 per business per day; change them with the `CHAT_LIMIT_PER_MINUTE` and `CHAT_LIMIT_PER_BUSINESS_PER_DAY` environment variables.
- `MIN_SIMILARITY` in `api/chat.js` (default 0.5) controls how related a document chunk must be before the model sees it. Lower it if the assistant misses answers that are in the knowledge base; raise it if it pulls in unrelated text.
