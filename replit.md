# Lumina Health – Phase 0 Backend

## Overview

A Fastify/TypeScript REST API backend for the Lumina Health project. It handles data ingestion from Apple HealthKit physiology samples and nutrition CSV exports, storing everything in PostgreSQL.

## Architecture

- **Runtime**: Node.js 20 with TypeScript (compiled via `ts-node` in dev)
- **Framework**: Fastify v4 with `@fastify/multipart` v8
- **Database**: PostgreSQL (Replit built-in) via the `pg` driver
- **Port**: 5000

## Key Files

- `src/server.ts` — Entry point; reads `PORT`/`HOST` from env
- `src/app.ts` — Fastify app factory (registers plugins + routes)
- `src/routes/ingest.ts` — Ingest route handlers
- `src/db/client.ts` — PostgreSQL pool + query wrapper
- `src/db/schema.sql` — Database schema (run once to initialise)
- `src/types/index.ts` — Shared TypeScript types

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check → `{ status: "ok", phase: 0 }` |
| POST | `/api/v1/ingest/physiology` | Ingest HealthKit physiology samples (JSON) |
| POST | `/api/v1/ingest/nutrition_csv` | Ingest nutrition data from a CSV upload (multipart) |

## Database Tables

- `user_profile` — User onboarding data (UUID primary key)
- `physiology_samples` — Time-series HealthKit data; upsert on `(user_id, ts, type)`
- `nutrition_events` — Meal/nutrition events; upsert on `(user_id, ts, meal_type)`

## Development

```bash
PORT=5000 npm run dev   # Start development server (ts-node)
npm run build           # Compile TypeScript → dist/
npm run test            # Run tests
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (set by Replit) |
| `PORT` | Server port (default: 3000; workflow uses 5000) |
| `HOST` | Bind host (default: 0.0.0.0) |
| `LOG_LEVEL` | Fastify log level (default: info) |
| `NODE_ENV` | Environment name |

## Deployment

- Target: **autoscale**
- Build: `npm run build` (TypeScript → `dist/`)
- Run: `node dist/server.js`
