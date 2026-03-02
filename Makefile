# Makefile para comandos comunes

.PHONY: help setup up down logs ps clean healthcheck verify

help:
	@echo "📚 Ecommerce Event-Driven - Comandos disponibles"
	@echo ""
	@echo "🚀 STARTUP"
	@echo "  make setup       - Preparar ambiente (copiar .env)"
	@echo "  make up          - Levantar todos los contenedores"
	@echo "  make down        - Detener todos los contenedores"
	@echo ""
	@echo "🔍 MONITOREO"
	@echo "  make ps          - Ver estado de contenedores"
	@echo "  make logs        - Ver logs en tiempo real"
	@echo "  make healthcheck - Verificar salud de servicios"
	@echo "  make verify      - Verificación completa"
	@echo ""
	@echo "🧹 LIMPIEZA"
	@echo "  make clean       - Limpiar contenedores (sin datos)"
	@echo "  make clean-all   - Limpiar todo (incluyendo datos) ⚠️"
	@echo ""

setup:
	@echo "📋 Preparando ambiente..."
	@if not exist .env copy .env.example .env
	@echo "✅ .env creado (o ya existía)"

up:
	@echo "🚀 Levantando infraestructura..."
	docker compose up -d
	@echo "⏳ Esperando healthchecks..."
	@timeout /t 15 /nobreak
	@echo "✅ Infraestructura lista"
	@make ps

down:
	@echo "⏹️  Deteniendo contenedores..."
	docker compose down
	@echo "✅ Contenedores detenidos"

ps:
	@echo "📊 Estado de contenedores:"
	@echo ""
	docker compose ps

logs:
	@echo "📒 Siguiendo logs en tiempo real (Ctrl+C para salir)..."
	docker compose logs -f

healthcheck:
	@echo "🏥 Verificando salud de servicios..."
	@echo ""
	@echo "1️⃣  Redpanda..."
	docker compose exec -T redpanda rpk cluster info 2>nul || echo "⏳ Redpanda iniciando..."
	@echo ""
	@echo "2️⃣  Orders DB..."
	docker compose exec -T orders-db psql -U orders_user -d orders_db -c "SELECT 'OK' AS status;" 2>nul || echo "⏳ Orders DB iniciando..."
	@echo ""
	@echo "3️⃣  Inventory DB..."
	docker compose exec -T inventory-db psql -U inventory_user -d inventory_db -c "SELECT 'OK' AS status;" 2>nul || echo "⏳ Inventory DB iniciando..."
	@echo ""
	@echo "✅ Verificación completada"

verify: healthcheck

clean:
	@echo "🗑️  Limpiando contenedores..."
	docker compose down
	@echo "✅ Limpieza completada"

clean-all:
	@echo "⚠️  LIMPIEZA COMPLETA (se perderán datos)..."
	@echo "Presiona Ctrl+C para cancelar, Intro para continuar..."
	@pause
	docker compose down -v
	@echo "✅ Todo limpio"
