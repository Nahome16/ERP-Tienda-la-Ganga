namespace LaGanga.Domain.Catalog;

public static class CategoryHierarchy
{
    /// <summary>
    /// Indica si colocar <paramref name="categoryId"/> dentro de
    /// <paramref name="newParentId"/> formaría un ciclo, recorriendo los
    /// antecesores con el mapa categoría → superior.
    /// </summary>
    public static bool WouldCreateCycle(
        Guid categoryId,
        Guid? newParentId,
        IReadOnlyDictionary<Guid, Guid?> parentsByCategory)
    {
        ArgumentNullException.ThrowIfNull(parentsByCategory);

        var visited = new HashSet<Guid>();
        var current = newParentId;
        while (current is { } ancestorId)
        {
            if (ancestorId == categoryId || !visited.Add(ancestorId))
            {
                return true;
            }

            current = parentsByCategory.TryGetValue(ancestorId, out var parent) ? parent : null;
        }

        return false;
    }
}
