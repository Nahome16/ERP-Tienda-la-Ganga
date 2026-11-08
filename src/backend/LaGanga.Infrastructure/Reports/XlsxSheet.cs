using ClosedXML.Excel;

namespace LaGanga.Infrastructure.Reports;

/// <summary>Escribe tablas sencillas en una hoja: encabezado con formato, filas tipadas y anchos fijos.</summary>
internal sealed class XlsxSheet
{
    private const string MoneyFormat = "#,##0.00";
    private const string IntegerFormat = "#,##0";
    private const string DateTimeFormat = "dd/mm/yyyy hh:mm";
    private const string DateFormat = "dd/mm/yyyy";

    private readonly IXLWorksheet _sheet;
    private int _row;
    private int _columns;

    public XlsxSheet(XLWorkbook workbook, string name)
    {
        _sheet = workbook.Worksheets.Add(name);
        _row = 1;
    }

    public void Title(string text, string? subtitle = null)
    {
        _sheet.Cell(_row, 1).Value = text;
        _sheet.Cell(_row, 1).Style.Font.Bold = true;
        _sheet.Cell(_row, 1).Style.Font.FontSize = 14;
        _row++;
        if (subtitle is not null)
        {
            _sheet.Cell(_row, 1).Value = subtitle;
            _sheet.Cell(_row, 1).Style.Font.FontColor = XLColor.DimGray;
            _row++;
        }

        _row++;
    }

    public void Header(string[] headers, double[] widths, bool freeze = true)
    {
        _columns = headers.Length;
        for (var column = 0; column < headers.Length; column++)
        {
            var cell = _sheet.Cell(_row, column + 1);
            cell.Value = headers[column];
            cell.Style.Font.Bold = true;
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#153A45");
            cell.Style.Alignment.WrapText = true;
            cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            _sheet.Column(column + 1).Width = widths[column];
        }

        _sheet.Row(_row).Height = 30;
        if (freeze)
        {
            _sheet.SheetView.FreezeRows(_row);
        }

        _row++;
    }

    public void Row(params object?[] values)
    {
        for (var column = 0; column < values.Length; column++)
        {
            var cell = _sheet.Cell(_row, column + 1);
            switch (values[column])
            {
                case null:
                    break;
                case decimal money:
                    cell.Value = money;
                    cell.Style.NumberFormat.Format = MoneyFormat;
                    break;
                case int integer:
                    cell.Value = integer;
                    cell.Style.NumberFormat.Format = IntegerFormat;
                    break;
                case long integer:
                    cell.Value = integer;
                    cell.Style.NumberFormat.Format = IntegerFormat;
                    break;
                case DateTime moment:
                    cell.Value = moment;
                    cell.Style.NumberFormat.Format = DateTimeFormat;
                    break;
                case DateOnly day:
                    cell.Value = day.ToDateTime(TimeOnly.MinValue);
                    cell.Style.NumberFormat.Format = DateFormat;
                    break;
                case bool flag:
                    cell.Value = flag ? "Sí" : "No";
                    break;
                default:
                    cell.Value = values[column]!.ToString();
                    // Los códigos de barras y similares deben quedar como texto, no como número.
                    cell.Style.NumberFormat.Format = "@";
                    break;
            }
        }

        _row++;
    }

    /// <summary>Fila de pares «concepto / valor» para hojas de resumen.</summary>
    public void KeyValue(string label, object? value, bool bold = false)
    {
        Row(label, value);
        if (bold)
        {
            _sheet.Row(_row - 1).Style.Font.Bold = true;
        }
    }

    public void Blank() => _row++;

    public void SectionTitle(string text)
    {
        _sheet.Cell(_row, 1).Value = text;
        _sheet.Cell(_row, 1).Style.Font.Bold = true;
        _sheet.Cell(_row, 1).Style.Font.FontColor = XLColor.FromHtml("#153A45");
        _row++;
    }

    public void Widths(params double[] widths)
    {
        for (var column = 0; column < widths.Length; column++)
        {
            _sheet.Column(column + 1).Width = widths[column];
        }
    }

    public void FinishTable(int firstDataRow)
    {
        if (_columns > 0 && _row - 1 >= firstDataRow)
        {
            _sheet.Range(firstDataRow - 1, 1, _row - 1, _columns).SetAutoFilter();
        }
    }

    public int NextRow => _row;
}
