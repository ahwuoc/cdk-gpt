# reg-chatgpt - Sell ChatGPT Application

Next.js project running with Bun and Supabase.

## Database

Create the Supabase tables/functions by reviewing and running
`supabase/schema.sql` manually in the Supabase SQL editor. This project does
not include an automatic migration because production Supabase projects may
already contain data.

Then configure:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
AUTH_SESSION_SECRET=change-me-to-a-long-random-secret
```

## Development

```bash
bun install
bun run dev
```

Open `http://localhost:3000`.

## Scripts

```bash
bun run dev
bun run build
bun run start
bun run lint
```
