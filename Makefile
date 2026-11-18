.DEFAULT_GOAL := help
COMPOSE := docker compose

.PHONY: help config build up down restart ps logs migrate makemigrations seed superuser expire cleanup test typecheck check manage shell-api shell-web

help:
	@echo SokoSoo local Docker development
	@echo "  make up             Build and start services; wait for health checks"
	@echo "  make down           Stop services; preserve database and Next.js cache"
	@echo "  make build          Rebuild images after dependency changes"
	@echo "  make restart        Restart services"
	@echo "  make ps             Show service status"
	@echo "  make logs           Follow logs (Ctrl+C to stop following)"
	@echo "  make config         Validate and show Compose configuration"
	@echo "  make migrate        Apply database migrations"
	@echo "  make makemigrations Generate migrations in the host source tree"
	@echo "  make seed           Create optional local demo accounts and produce"
	@echo "  make superuser      Create an administrator interactively"
	@echo "  make expire         Expire unpaid reservations"
	@echo "  make cleanup        Run Phase 1 archival, enquiry and cart cleanup"
	@echo "  make test           Run Django and focused frontend tests"
	@echo "  make typecheck      Run frontend TypeScript validation"
	@echo "  make check          Run Django configuration checks"
	@echo "  make manage ARGS=... Run a Django management command"
	@echo "  make shell-api      Open an API container shell"
	@echo "  make shell-web      Open a web container shell"

config:
	$(COMPOSE) config

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up --build --detach --wait --wait-timeout 240

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs --follow --tail=100

migrate:
	$(COMPOSE) exec -T api python manage.py migrate --noinput

makemigrations:
	$(COMPOSE) exec -T api python manage.py makemigrations

seed:
	$(COMPOSE) exec -T api python manage.py seed_demo

superuser:
	$(COMPOSE) exec api python manage.py createsuperuser

expire:
	$(COMPOSE) exec -T api python manage.py expire_reservations

cleanup:
	$(COMPOSE) exec -T api python manage.py cleanup_marketplace

test:
	$(COMPOSE) exec -T api python manage.py test market
	$(COMPOSE) exec -T web node --experimental-strip-types --test src/lib/bag.test.mjs src/lib/ui.test.mjs

typecheck:
	$(COMPOSE) exec -T web npm run typecheck

check:
	$(COMPOSE) exec -T api python manage.py check

manage:
	$(COMPOSE) exec api python manage.py $(ARGS)

shell-api:
	$(COMPOSE) exec api sh

shell-web:
	$(COMPOSE) exec web sh
