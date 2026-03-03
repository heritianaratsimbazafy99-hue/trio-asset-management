# TRIO Asset Management (MVP)

This repository contains a minimal Next.js application implementing the foundation of an asset management system for the TRIO holding company. It provides basic authentication via Supabase and simple CRUD operations for assets.

## Prerequisites

- [Node.js](https://nodejs.org/) (version 18 or later)
- A [Supabase](https://supabase.com) project with an `assets` table. Suggested columns:
  - `id` (UUID or integer, primary key)
  - `code` (string)
  - `name` (string)
  - `category` (string)
  - `status` (string)
  - `description` (text)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env.local` file in the root of the project and add your Supabase credentials.
   An example file is provided at `.env.example`. Copy it to `.env.local` and replace the placeholder values with your own:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

3. Run the development server:

   ```bash
   npm run dev
   ```

   The application will be available at [http://localhost:3000](http://localhost:3000).

## Quality Gate (Before Deploy)

Run the project quality gate:

```bash
npm run check
```

This command runs:

- `check:predeploy`: verifies required files and environment keys
- `check:build`: runs a production build (`next build`)

## Available Pages

| Route            | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `/login`         | User login via email/password. Authenticates with Supabase.       |
| `/assets`        | Displays a list of assets fetched from the `assets` table.        |
| `/assets/[id]`   | Shows details for a single asset.                                  |
| `/assets/create` | Form to create a new asset.                                       |
| `/logout`        | Signs the user out and redirects to the login page.               |

## Notes

- This project is a starting point and does not include advanced features such as role-based access control, maintenance management, amortization calculations or multi-company support. Those can be added by extending the data model and components.
- Styling is intentionally minimal and can be enhanced to match your corporate branding guidelines.
- Environment variables are exposed at build time via `NEXT_PUBLIC_` prefixes. Do not expose secrets other than the public anon key.

## License

MIT License
