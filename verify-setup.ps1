#!/usr/bin/env pwsh
# =============================================================================
# Script de verificación - E-Commerce Event-Driven
# Verifica que toda la infraestructura esté funcionando correctamente
# =============================================================================
# Uso: .\verify-setup.ps1
# =============================================================================

Write-Host "🔍 Verificando infraestructura Event-Driven..." -ForegroundColor Cyan
Write-Host ""

# =============================================================================
# 1. Verificar Docker Compose
# =============================================================================
Write-Host "1️⃣  Docker Compose" -ForegroundColor Yellow
Write-Host "=================" -ForegroundColor Yellow

try {
    $composeVersion = docker compose version 2>&1
    if ($?) {
        Write-Host "✅ Docker Compose instalado" -ForegroundColor Green
        Write-Host "   Versión: $($composeVersion -split '\n')[0]" -ForegroundColor Gray
    }
}
catch {
    Write-Host "❌ Docker Compose no encontrado" -ForegroundColor Red
    exit 1
}

Write-Host ""

# =============================================================================
# 2. Verificar contenedores corriendo
# =============================================================================
Write-Host "2️⃣  Contenedores en ejecución" -ForegroundColor Yellow
Write-Host "=============================" -ForegroundColor Yellow

$containers = docker compose ps --format json | ConvertFrom-Json -ErrorAction SilentlyContinue

if ($containers) {
    foreach ($container in $containers) {
        $status = if ($container.State -like "*running*") {
            "✅ Running"
        } else {
            "⏳ Starting"
        }
        Write-Host "$status - $($container.Service) ($($container.State))" -ForegroundColor Gray
    }
} else {
    Write-Host "❌ No hay contenedores ejecutándose" -ForegroundColor Red
    Write-Host "⚠️  Ejecuta: docker compose up -d" -ForegroundColor Yellow
}

Write-Host ""

# =============================================================================
# 3. Verificar Redpanda
# =============================================================================
Write-Host "3️⃣  Redpanda (Kafka Broker)" -ForegroundColor Yellow
Write-Host "============================" -ForegroundColor Yellow

try {
    $redpandaStatus = docker compose exec -T redpanda rpk cluster info 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Redpanda activo" -ForegroundColor Green
        $brokers = $redpandaStatus -match "Brokers:" -split ":" | Select-Object -Last 1
        Write-Host "   Brokers: $($brokers.Trim())" -ForegroundColor Gray
    } else {
        Write-Host "⏳ Redpanda inicializándose..." -ForegroundColor Yellow
    }
}
catch {
    Write-Host "⏳ Redpanda no está listo aún" -ForegroundColor Yellow
}

Write-Host ""

# =============================================================================
# 4. Verificar Orders Database
# =============================================================================
Write-Host "4️⃣  Orders Database (PostgreSQL)" -ForegroundColor Yellow
Write-Host "=================================" -ForegroundColor Yellow

try {
    $ordersDbTest = docker compose exec -T orders-db psql -U orders_user -d orders_db -c "SELECT version();" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Orders DB activa" -ForegroundColor Green
        $version = $ordersDbTest -match "PostgreSQL" | Select-Object -First 1
        if ($version) {
            Write-Host "   $($version.Trim())" -ForegroundColor Gray
        }
    } else {
        Write-Host "⏳ Orders DB inicializándose..." -ForegroundColor Yellow
    }
}
catch {
    Write-Host "⏳ Orders DB no está lista aún" -ForegroundColor Yellow
}

Write-Host ""

# =============================================================================
# 5. Verificar Inventory Database
# =============================================================================
Write-Host "5️⃣  Inventory Database (PostgreSQL)" -ForegroundColor Yellow
Write-Host "===================================" -ForegroundColor Yellow

try {
    $inventoryDbTest = docker compose exec -T inventory-db psql -U inventory_user -d inventory_db -c "SELECT version();" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Inventory DB activa" -ForegroundColor Green
        $version = $inventoryDbTest -match "PostgreSQL" | Select-Object -First 1
        if ($version) {
            Write-Host "   $($version.Trim())" -ForegroundColor Gray
        }
    } else {
        Write-Host "⏳ Inventory DB inicializándose..." -ForegroundColor Yellow
    }
}
catch {
    Write-Host "⏳ Inventory DB no está lista aún" -ForegroundColor Yellow
}

Write-Host ""

# =============================================================================
# 6. Verificar conectividad de puertos
# =============================================================================
Write-Host "6️⃣  Puertos abiertos" -ForegroundColor Yellow
Write-Host "====================" -ForegroundColor Yellow

$ports = @(
    @{ Name = "Redpanda (Kafka)"; Host = "localhost"; Port = 9092 },
    @{ Name = "Orders DB"; Host = "localhost"; Port = 5432 },
    @{ Name = "Inventory DB"; Host = "localhost"; Port = 5433 },
    @{ Name = "Redpanda Admin"; Host = "localhost"; Port = 9644 }
)

foreach ($port in $ports) {
    $connection = $null
    try {
        $connection = New-Object System.Net.Sockets.TcpClient
        $connection.Connect($port.Host, $port.Port)
        Write-Host "✅ $($port.Name) ($($port.Host):$($port.Port)) - Abierto" -ForegroundColor Green
    }
    catch {
        Write-Host "❌ $($port.Name) ($($port.Host):$($port.Port)) - Cerrado" -ForegroundColor Red
    }
    finally {
        if ($connection) {
            $connection.Close()
            $connection.Dispose()
        }
    }
}

Write-Host ""

# =============================================================================
# RESUMEN FINAL
# =============================================================================
Write-Host "✅ Verificación completada" -ForegroundColor Cyan
Write-Host ""
Write-Host "📚 Próximos pasos:" -ForegroundColor Cyan
Write-Host "  1. Ver logs:     docker compose logs -f" -ForegroundColor Gray
Write-Host "  2. Leer docs:    Abre README.md" -ForegroundColor Gray
Write-Host "  3. Implementar:  services/order-service y services/inventory-service" -ForegroundColor Gray
