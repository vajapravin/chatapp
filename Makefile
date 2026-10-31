.PHONY: help up down restart logs test migrate seed stats clean

help:
	@echo "Chatapp Management Commands:"
	@echo "  make up       - Start core stack with docker compose"
	@echo "  make down     - Stop docker compose stack"
	@echo "  make restart  - Restart docker compose stack"
	@echo "  make logs     - View live service logs"
	@echo "  make test     - Run Python unit and integration tests"
	@echo "  make migrate  - Run database migrations via Alembic"
	@echo "  make seed     - Seed initial demo users"
	@echo "  make stats    - Display container memory and CPU stats"

up:
	docker compose --profile core up -d --build

down:
	docker compose --profile core down

restart:
	docker compose --profile core restart

logs:
	docker compose logs -f

test:
	source .venv/bin/activate && pytest api/tests

migrate:
	docker compose exec api alembic upgrade head

seed:
	docker compose exec api python -m src.scripts.seed

stats:
	docker stats --no-stream
