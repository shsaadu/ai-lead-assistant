# AI Website Support & Lead Capture Agent

A portfolio-ready demo for a service-business website: customers can ask questions, receive AI-assisted responses, and leave a qualified lead. The sample brand is a fictional plumbing company so the experience is easy for prospective clients to understand.

## What works now

- Responsive customer-facing service website
- Chat widget with quick replies and AI response API
- Lead-capture form activated from high-intent messages such as "I have a leak" or "get a quote"
- Local lead storage, so the demo works without any database setup
- Gemini integration through a Vercel serverless function when `GEMINI_API_KEY` is set

## Run locally

This has no frontend build step. From this directory, serve the static files using any local server. For a production-like API route, deploy directly to Vercel and add `GEMINI_API_KEY` in the project environment variables.

## Production path

Before selling this to a client, replace browser-only lead storage with Supabase or another database, add email/CRM delivery, a privacy notice and consent, rate limiting, and a client-specific knowledge base.

## Portfolio description

Built a reusable AI lead-capture assistant for service businesses. The assistant answers common customer questions, recognises booking or quotation intent, and converts conversations into structured leads. Deployed as a lightweight Vercel site with an optional Gemini-powered response API.
