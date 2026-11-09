COMPOSE = docker compose -f infra/compose.yml
.PHONY: up down infra migrate seed test build perf
infra:      ## postgres, redis, seaweedfs, mailpit only (run api locally)
	$(COMPOSE) up -d --wait postgres redis seaweedfs mailpit
up:         ## full stack
	$(COMPOSE) up -d --build --wait
down:
	$(COMPOSE) down
migrate:
	node tools/build-migration.mjs && pnpm --filter @oja/db migrate
seed:
	pnpm --filter @oja/db seed
build:
	pnpm build
test:
	pnpm test
perf:
	k6 run tests/perf/checkout.js
