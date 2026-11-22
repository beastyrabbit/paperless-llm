.PHONY: build up down logs check
build:
	docker compose build
up:
	docker compose up -d
down:
	docker compose down
logs:
	docker compose logs -f
check:
	pnpm precommit
	pnpm test
