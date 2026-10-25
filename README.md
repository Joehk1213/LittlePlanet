# LittlePlanet

LittlePlanet is a Node.js and Express application backed by Supabase, with a static storefront served from `public/`.

## Requirements

- Node.js 22 or later
- npm
- Supabase environment values configured from `.env.example`

## Run locally

```powershell
npm ci
npm run dev
```

The server listens on port `3000` by default. Check `http://localhost:3000/health` for the liveness response. Use `npm start` to run without the development watcher.

## Common commands

```powershell
npm test
npm run lint
npm run format
```

`npm run format` formats JavaScript files in `src/` and `scripts/`.

## Repository layout

| Path | Contents |
| --- | --- |
| `index.js` | Express application entry point. |
| `src/routes/` | API route modules. |
| `src/middleware/` | Express middleware. |
| `src/utils/` | Shared server utilities. |
| `scripts/` | Project maintenance and data utilities. |
| `public/` | Static storefront files. |
| `public/assets/images/` | Storefront image assets; replaces the old `public/image/` location. |
| `docs/` | Deployment and project documentation. |

### Route module names

- `src/routes/customer.js` serves customer member endpoints under `/api/customer`.
- `src/routes/customers.js` serves the admin CRM under `/api/admin/customers`. These files serve different audiences and are both required.
- `src/routes/payments.js` contains payment-proof routes; it replaces the former `payment-proofs.js` module.
- `src/routes/webhooks.js` contains webhook routes; it replaces the former `webhook.js` module.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for environment setup, migrations, and deployment instructions.
