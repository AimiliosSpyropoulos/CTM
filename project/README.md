# TM Studio (Composite Turing Machines)

Monorepo:
- `apps/web` — Next.js 14 (App Router) fullstack, NextAuth Credentials, Prisma
- `packages/tm-engine` — deterministic TM engine with composite call-stack

## Quick start (local)

Prereqs: Node 20+, pnpm, Postgres.

```bash
cd tm-studio
pnpm install
cp apps/web/.env.example apps/web/.env
# set DATABASE_URL + NEXTAUTH_SECRET
pnpm -C apps/web prisma migrate dev
pnpm dev
```

Open: `http://localhost:3000`.

## Roles
- Register page creates `STUDENT` users.
- `ADMIN` can create `TEACHER/ADMIN/STUDENT` users from `/admin`.

