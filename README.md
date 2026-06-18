# Connectify Backend

Backend scaffold aligned to `docs/CONNECTIFY_EXECUTION_BLUEPRINT.md`.

## Quick start

1. Copy `.env.example` to `.env`
2. Install dependencies:
   - `npm install`
3. Run dev server:
   - `npm run dev`

4. Optional — bootstrap an admin dashboard user (credentials only in `backend/.env`, never in git):
   - Copy the `SEED_ADMIN_*` lines from `.env.example` into `.env`, set email and password, then run `npm run seed:admin`.
   - In production, set `SEED_ADMIN_CONFIRM=yes` or the script will refuse to run.

## Current status

- Express + TypeScript server bootstrapped
- Mongo + Redis connectors added
- Socket.IO server initialized with JWT handshake
- API endpoints scaffolded under `/api/v1`
- Route handlers are placeholders ready for module implementation

## Next implementation steps

- Split `src/modules/index.ts` into module-level routers/controllers/services
- Add Mongoose schemas for the 14 collections
- Add request validation schemas (Zod)
- Implement auth (register/login/refresh/logout)
- Add integration tests in `tests/`

