#!/bin/bash
# =============================================================================
# Script de verificación - E-Commerce Event-Driven
# Verifica que toda la infraestructura esté funcionando correctamente
# =============================================================================
# Uso: ./verify-setup.sh
# =============================================================================

set -o errexit

echo "🔍 Verificando infraestructura Event-Driven..."
echo ""

# =============================================================================
# 1. Verificar Docker Compose
# =============================================================================
echo "1️⃣  Docker Compose"
echo "=================="

if command -v docker &> /dev/null && docker compose version &> /dev/null; then
    echo "✅ Docker Compose instalado"
    docker compose version | head -n 1 | sed 's/^/   /'
else
    echo "❌ Docker Compose no encontrado"
    exit 1
fi

echo ""

# =============================================================================
# 2. Verificar contenedores corriendo
# =============================================================================
echo "2️⃣  Contenedores en ejecución"
echo "============================="

docker compose ps --format table

echo ""

# =============================================================================
# 3. Verificar Redpanda
# =============================================================================
echo "3️⃣  Redpanda (Kafka Broker)"
echo "============================="

if docker compose exec -T redpanda rpk cluster info &> /dev/null; then
    echo "✅ Redpanda activo"
    docker compose exec -T redpanda rpk cluster info | grep -E "Brokers:|Topics:|Partitions:" | sed 's/^/   /'
else
    echo "⏳ Redpanda inicializándose..."
fi

echo ""

# =============================================================================
# 4. Verificar Orders Database
# =============================================================================
echo "4️⃣  Orders Database (PostgreSQL)"
echo "================================="

if docker compose exec -T orders-db psql -U orders_user -d orders_db -c "SELECT 'OK' AS status;" 2>/dev/null; then
    echo "✅ Orders DB activa"
    docker compose exec -T orders-db psql -U orders_user -d orders_db -c "SELECT version();" 2>/dev/null | sed 's/^/   /'
else
    echo "⏳ Orders DB inicializándose..."
fi

echo ""

# =============================================================================
# 5. Verificar Inventory Database
# =============================================================================
echo "5️⃣  Inventory Database (PostgreSQL)"
echo "===================================="

if docker compose exec -T inventory-db psql -U inventory_user -d inventory_db -c "SELECT 'OK' AS status;" 2>/dev/null; then
    echo "✅ Inventory DB activa"
    docker compose exec -T inventory-db psql -U inventory_user -d inventory_db -c "SELECT version();" 2>/dev/null | sed 's/^/   /'
else
    echo "⏳ Inventory DB inicializándose..."
fi

echo ""

# =============================================================================
# 6. Verificar conectividad de puertos
# =============================================================================
echo "6️⃣  Puertos abiertos"
echo "===================="

check_port() {
    if timeout 1 bash -c "echo >/dev/tcp/localhost/$2" 2>/dev/null; then
        echo "✅ $1 (localhost:$2) - Abierto"
    else
        echo "❌ $1 (localhost:$2) - Cerrado"
    fi
}

check_port "Redpanda (Kafka)" 9092
check_port "Orders DB" 5432
check_port "Inventory DB" 5433
check_port "Redpanda Admin" 9644

echo ""

# =============================================================================
# RESUMEN FINAL
# =============================================================================
echo "✅ Verificación completada"
echo ""
echo "📚 Próximos pasos:"
echo "  1. Ver logs:     docker compose logs -f"
echo "  2. Leer docs:    less README.md"
echo "  3. Implementar:  services/order-service y services/inventory-service"
