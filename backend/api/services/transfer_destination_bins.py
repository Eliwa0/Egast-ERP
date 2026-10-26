"""SAP destination bin requirements, independent of physical pallet positions."""


class DestinationSAPBinError(ValueError):
    """Validation failed before a StockTransfers request can be sent."""


def destination_bin_options(sap_client, warehouse):
    details = sap_client.get_warehouse_details(warehouse)
    if not isinstance(details, dict) or details.get('error') or details.get('WarehouseCode') != warehouse:
        raise DestinationSAPBinError('Cannot verify destination SAP warehouse metadata.')
    enabled = details.get('EnableBinLocations')
    if details.get('Inactive') in ('tYES', True):
        raise DestinationSAPBinError('Destination SAP warehouse is inactive.')
    if enabled not in ('tYES', 'tNO', True, False):
        raise DestinationSAPBinError('Cannot verify destination SAP bin requirement.')
    required = enabled in ('tYES', True)
    bins = []
    if required:
        result = sap_client.get_bin_locations_by_warehouse(warehouse)
        if not isinstance(result, dict) or result.get('error') or not isinstance(result.get('value'), list):
            raise DestinationSAPBinError('Cannot load destination SAP bins.')
        for row in result['value']:
            if row.get('Warehouse') != warehouse or row.get('Inactive') not in ('tNO', False):
                continue
            if row.get('IsSystemBin') in ('tYES', True) or row.get('SystemBin') in ('tYES', True) or 'SYSTEM' in str(row.get('BinCode', '')).upper():
                continue
            try:
                abs_entry = int(row.get('AbsEntry'))
            except (TypeError, ValueError):
                continue
            if abs_entry > 0 and row.get('BinCode'):
                bins.append({'code': row['BinCode'], 'name': row.get('Description') or row['BinCode'], 'absEntry': abs_entry})
    return {'warehouse_code': warehouse, 'requires_bin': required, 'locations': bins}


def validate_destination_bin(sap_client, payload):
    options = destination_bin_options(sap_client, str(payload['to_warehouse']).strip())
    selected = str(payload.get('to_bin') or '').strip()
    if not options['requires_bin']:
        if selected:
            raise DestinationSAPBinError('Destination SAP warehouse does not use bin locations.')
        return None
    if not options['locations']:
        raise DestinationSAPBinError('This warehouse requires an SAP bin location, but no valid bins are available.')
    if not selected:
        raise DestinationSAPBinError('Destination SAP bin is required.')
    match = next((row for row in options['locations'] if row['code'] == selected), None)
    if match is None:
        raise DestinationSAPBinError('Destination SAP bin must belong to the warehouse, be active, and not be a system bin.')
    return match['absEntry']


def validate_destination_allocations(sap_lines, abs_entry):
    from decimal import Decimal
    for index, line in enumerate(sap_lines):
        allocations = [row for row in line.get('StockTransferLinesBinAllocations', [])
                       if row.get('BinActionType') == 'batToWarehouse']
        if abs_entry is None:
            if allocations:
                raise DestinationSAPBinError('Unexpected destination SAP bin allocation.')
            continue
        if len(allocations) != 1:
            raise DestinationSAPBinError('Fully allocate each transfer line to its destination SAP bin.')
        allocation = allocations[0]
        quantity = Decimal(str(line['Quantity']))
        if (quantity <= 0 or allocation.get('BinAbsEntry') != abs_entry
                or allocation.get('BaseLineNumber') != index
                or Decimal(str(allocation.get('Quantity', 0))) != quantity):
            raise DestinationSAPBinError('Destination SAP bin allocation must equal the full transfer quantity.')
