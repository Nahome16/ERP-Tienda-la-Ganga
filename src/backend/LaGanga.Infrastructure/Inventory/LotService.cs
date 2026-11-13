using LaGanga.Domain.Inventory;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Inventory;

/// <summary>
/// Control de entradas de mercadería (por socio, costo y precio) con salida PEPS.
/// Invariante: la suma de lo que queda en las entradas de una variante es igual a su existencia
/// (o a cero si la existencia es negativa). <see cref="ReconcileAsync"/> lo restablece.
/// Se usa siempre dentro de la misma operación (y transacción) que cambia el saldo.
/// </summary>
internal sealed class LotService(LaGangaDbContext dbContext)
{
    /// <summary>Registra una entrada. Si el saldo estaba en negativo, parte de la entrada cubre ese faltante.</summary>
    public StockLot AddLot(
        Guid variantId,
        Guid? partnerId,
        LotSource source,
        int quantity,
        int balanceBefore,
        decimal? unitCost,
        decimal? unitPrice,
        string? note,
        Guid? userId,
        DateTimeOffset now)
    {
        var covered = balanceBefore < 0 ? Math.Min(quantity, -balanceBefore) : 0;
        var lot = new StockLot(Guid.NewGuid(), variantId, partnerId, source, quantity, quantity - covered, unitCost, unitPrice, note, userId, now);
        dbContext.StockLots.Add(lot);
        return lot;
    }

    /// <summary>Descuenta de las entradas más antiguas. Lo que no alcanza queda como faltante sin asignar.</summary>
    public async Task<IReadOnlyList<LotAllocation>> ConsumeAsync(
        Guid variantId,
        int quantity,
        AllocationKind kind,
        Guid? saleId,
        Guid? saleLineId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var lots = (await dbContext.StockLots
                .Where(lot => lot.VariantId == variantId && lot.QuantityRemaining > 0)
                .OrderBy(lot => lot.EnteredAtUtc).ThenBy(lot => lot.Id)
                .ToListAsync(cancellationToken))
            .Where(lot => lot.QuantityRemaining > 0)
            .ToList();
        var allocations = new List<LotAllocation>();
        var pending = quantity;
        foreach (var lot in lots)
        {
            if (pending == 0)
            {
                break;
            }

            var taken = Math.Min(pending, lot.QuantityRemaining);
            lot.QuantityRemaining -= taken;
            pending -= taken;
            allocations.Add(new LotAllocation(Guid.NewGuid(), lot.Id, variantId, kind, taken, saleId, saleLineId, now));
        }

        if (pending > 0)
        {
            allocations.Add(new LotAllocation(Guid.NewGuid(), null, variantId, kind, pending, saleId, saleLineId, now));
        }

        dbContext.LotAllocations.AddRange(allocations);
        return allocations;
    }

    /// <summary>Devuelve a su entrada original las unidades de una venta anulada.</summary>
    public async Task RestoreSaleAsync(Guid saleId, CancellationToken cancellationToken)
    {
        var allocations = await dbContext.LotAllocations
            .Where(allocation => allocation.SaleId == saleId && allocation.LotId != null)
            .ToListAsync(cancellationToken);
        var lotIds = allocations.Select(allocation => allocation.LotId!.Value).Distinct().ToArray();
        var lots = await dbContext.StockLots.Where(lot => lotIds.Contains(lot.Id)).ToDictionaryAsync(lot => lot.Id, cancellationToken);
        foreach (var allocation in allocations)
        {
            var lot = lots[allocation.LotId!.Value];
            lot.QuantityRemaining = Math.Min(lot.QuantityIn, lot.QuantityRemaining + allocation.Quantity);
        }
    }

    /// <summary>
    /// Devuelve a su entrada original unidades de una línea de venta (cambio de talla).
    /// Se descuenta primero de las asignaciones más recientes de esa línea.
    /// </summary>
    public async Task ReturnFromSaleLineAsync(Guid saleLineId, Guid variantId, int quantity, CancellationToken cancellationToken)
    {
        var allocations = await dbContext.LotAllocations
            .Where(allocation => allocation.SaleLineId == saleLineId && allocation.VariantId == variantId && allocation.Kind == AllocationKind.Sale)
            .OrderByDescending(allocation => allocation.CreatedAtUtc).ThenByDescending(allocation => allocation.Id)
            .ToListAsync(cancellationToken);
        var lotIds = allocations.Where(allocation => allocation.LotId != null).Select(allocation => allocation.LotId!.Value).Distinct().ToArray();
        var lots = await dbContext.StockLots.Where(lot => lotIds.Contains(lot.Id)).ToDictionaryAsync(lot => lot.Id, cancellationToken);
        var pending = quantity;
        foreach (var allocation in allocations)
        {
            if (pending == 0)
            {
                break;
            }

            var taken = Math.Min(pending, allocation.Quantity);
            if (allocation.LotId is { } lotId)
            {
                var lot = lots[lotId];
                lot.QuantityRemaining = Math.Min(lot.QuantityIn, lot.QuantityRemaining + taken);
            }

            if (taken == allocation.Quantity)
            {
                dbContext.LotAllocations.Remove(allocation);
            }
            else
            {
                allocation.Reduce(taken);
            }

            pending -= taken;
        }
    }

    /// <summary>
    /// Corrección de ingreso: descuenta unidades de las entradas más recientes que todavía las
    /// tienen, bajando lo ingresado (no es una pérdida del socio).
    /// </summary>
    public async Task CorrectEntriesAsync(Guid variantId, int units, CancellationToken cancellationToken)
    {
        var lots = await dbContext.StockLots
            .Where(lot => lot.VariantId == variantId && lot.QuantityRemaining > 0)
            .OrderByDescending(lot => lot.EnteredAtUtc).ThenByDescending(lot => lot.Id)
            .ToListAsync(cancellationToken);
        var pending = units;
        foreach (var lot in lots)
        {
            if (pending == 0)
            {
                break;
            }

            var taken = Math.Min(pending, lot.QuantityRemaining);
            lot.CorrectQuantityIn(taken);
            pending -= taken;
        }
    }

    /// <summary>Cuadra las entradas con la existencia real de la variante (ver la invariante de la clase).</summary>
    public async Task ReconcileAsync(Guid variantId, int balance, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var persisted = await dbContext.StockLots.Where(lot => lot.VariantId == variantId).ToListAsync(cancellationToken);
        var lots = persisted.Concat(dbContext.StockLots.Local.Where(lot => lot.VariantId == variantId && !persisted.Contains(lot))).ToList();
        var remaining = lots.Sum(lot => lot.QuantityRemaining);
        var target = Math.Max(balance, 0);
        if (remaining < target)
        {
            var cost = await dbContext.Variants.Where(variant => variant.Id == variantId).Select(variant => variant.Cost).SingleAsync(cancellationToken);
            var missing = target - remaining;
            dbContext.StockLots.Add(new StockLot(Guid.NewGuid(), variantId, null, LotSource.Restock, missing, missing, cost, null, "Unidades sin entrada registrada", null, now));
        }
        else if (remaining > target)
        {
            var excess = remaining - target;
            foreach (var lot in lots.Where(candidate => candidate.QuantityRemaining > 0).OrderBy(candidate => candidate.EnteredAtUtc).ThenBy(candidate => candidate.Id))
            {
                if (excess == 0)
                {
                    break;
                }

                var taken = Math.Min(excess, lot.QuantityRemaining);
                lot.QuantityRemaining -= taken;
                excess -= taken;
            }
        }
    }
}
