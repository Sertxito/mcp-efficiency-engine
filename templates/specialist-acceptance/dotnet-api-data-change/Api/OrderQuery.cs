using Microsoft.EntityFrameworkCore;

namespace TenantOrders;

// Deliberately defective. Repair in a disposable project, not in this template.
public sealed class OrderQuery(OrdersDb db)
{
    public async Task<IReadOnlyList<OrderDto>> LoadAsync(
        string tenant, string? status, int page, int size, CancellationToken ct)
    {
        var orders = await db.Orders.ToListAsync();
        return orders.Select(order => new OrderDto(order.Id, order.Status, order.Total)).ToArray();
    }
}
