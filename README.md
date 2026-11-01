# Backscroll

Backscroll is a mobile-first Indian internet nostalgia archive. Visitors can browse moments by year, category, or keyword; open a moment with its source; share a direct link; and submit a personal memory for editorial review. People can post anonymously or optionally create a member ID, then attach that ID to their memories. Editors approve or reject submissions in a token-protected review page.

## Features

- Responsive landing page and archive at `/`
- Moment filters for year, category, and text search
- Source links attached to every curated moment
- Direct-link sharing for each moment (`#moment=<id>`)
- Memory submissions with optional era, location, and language
- Anonymous posting by default, with optional Backscroll membership
- Reusable public member ID plus a private recovery key for posting on another device
- Member recovery keys stored as hashes in the database, never as raw server-side tokens
- Pending-by-default community content; only approved memories are public
- Editor review queue at `/admin`
- Plug-and-play file, SQLite, and Supabase storage drivers
- Supabase Postgres persistence for Vercel deployments
- No AI provider, vector index, or external runtime package required

## Run locally

Requires Node.js 20.10 or newer. From the repository root:

```sh
node server/index.js
```

Open [http://localhost:3000](http://localhost:3000). Set `PORT` to use a different port. With no database settings, the app uses JSON files under `data/`. To use a local SQLite database instead, set `DATABASE_DRIVER=sqlite`; the database is created at `data/backscroll.sqlite` automatically. SQLite requires Node.js 22.5 or newer; Node.js 24.15 or newer is recommended. To enable the editor locally, start the server with `ADMIN_TOKEN` set, then enter the same token at `/admin`.

PowerShell example:

```powershell
$env:ADMIN_TOKEN = 'choose-a-long-random-secret'
$env:DATABASE_DRIVER = 'sqlite'
node server/index.js
```

Members and memories use the same storage driver. Local JSON data files and SQLite database files are ignored by Git so visitor content is not committed accidentally. You can move between `file`, `sqlite`, and `supabase` by changing `DATABASE_DRIVER`; each driver uses the same storage interface and schema fields.

### Membership and privacy

Membership is optional. Anonymous remains the default for first-time visitors. Joining creates a public ID in the form `BS-<random characters>` and a separate private recovery key. The server stores only a SHA-256 hash of that high-entropy key. The browser keeps the key locally so members can post from this device, and the page offers a copyable member card for recovery on another device. A recovered key is sent only over the site's API to verify membership. There is no email, password, or third-party identity provider.

If a member loses the private recovery key and still has a browser with the saved membership, they can copy the key again from the join panel. If both the key and saved browser data are lost, the membership cannot currently be recovered. Members can choose **Post anonymously** on any submission; anonymous memories are saved without a member ID.

## Deploy to Vercel

The `public/` directory contains the static site, `api/[...path].js` exposes the API as a Vercel Function, and `vercel.json` points Vercel at the static output. Vercel Functions have ephemeral/read-only application filesystems, so configure Supabase before enabling submissions in a deployment.

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor. It creates or adds the members and memory fields needed by this version.
3. Add these environment variables to the Vercel project for each deployment environment:
   - `SUPABASE_URL` — project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — server-side service role key; never put this in frontend code
   - `DATABASE_DRIVER=supabase`
   - `ADMIN_TOKEN` — a long, random editor token
4. Import the Git repository into Vercel and deploy. No build step or package install is needed.

The curated archive is stored in `data/moments.json` and included with the API function. Update it in Git when editing or adding moments. Supabase stores members and contributed memories; the service key is only used inside the server function. Row Level Security is enabled and no public client policies are added. Vercel deployments require Supabase because their function filesystem does not provide shared durable storage.

## API

All API responses are JSON.

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `GET /api/moments` | List moments; accepts `year`, `fromYear`, `toYear`, `category`, and `q` query parameters |
| `GET /api/memories?momentId=<id>` | List approved memories, optionally for one moment |
| `POST /api/members` | Create a membership with `{ displayName? }`; returns a public member ID and one-time private recovery key |
| `POST /api/members/verify` | Restore membership on a device with `{ memberId, memberToken }` |
| `POST /api/memories` | Submit `{ text, momentId?, era?, region?, language? }`; text must be 12–500 characters. Send both `X-Member-ID` and `X-Member-Token` to post as a member; omit both to post anonymously |
| `GET /api/admin/memories` | List pending submissions; requires `Authorization: Bearer <ADMIN_TOKEN>` |
| `PATCH /api/admin/memories/<id>` | Approve or reject with `{ "status": "approved" }` or `{ "status": "rejected" }`; requires editor token |

## Project structure

```text
api/                  Vercel serverless API entry point
data/moments.json     Curated, sourced archive
public/               Static frontend and editor page
server/api.js          Shared API routes and validation
server/index.js        Local Node HTTP server
server/storage.js      File / SQLite / Supabase storage adapters
supabase/schema.sql    Supabase schema and indexes
vercel.json            Static output configuration
```

## Content and source links

Moment source URLs are in `data/moments.json`. The links were reviewed during the project update on 1 Nov 2026. Some publishers block automated page retrieval even when the page exists; the known IAMAI PDF URL had a confirmed 404 and was replaced with a working Indian Express report on Jio's launch. Check the live links again before a public release, since publishers can move or remove pages.

## Current scope and next steps

This is a complete functional MVP, not a finished archival institution. The seed archive is intentionally small and primarily English/Hindi; broaden it with regional editors and citations. Before opening submissions publicly, add rate limiting, member key rotation, user-facing membership deletion requests, and automated spam controls. For production traffic, consider moving the curated archive into Postgres as well and adding database migrations to the deployment workflow.
