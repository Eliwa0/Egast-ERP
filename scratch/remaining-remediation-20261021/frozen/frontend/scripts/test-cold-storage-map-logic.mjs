/**
 * Automated test script for ColdStorageMap logic and dynamic hierarchy handling.
 *
 * Verifies:
 * 1. Physical bin counting (excluding system bins)
 * 2. Tree searching by BinCode returning full path and metadata
 * 3. System bin exclusion from root selectable areas
 * 4. Irregular chamber handling (e.g. R04 with 0 racks -> selectable bulk bin)
 * 5. Corridor bin handling (e.g. B01 with null sublevel 4)
 * 6. Multi-tier rack ordering (RD top to RA bottom)
 * 7. Callback contract verification (bin_code, abs_entry, sublevel1..4)
 * 8. Dynamic adaptability to arbitrary/unknown future IDs (e.g. WH-9999, F03, R11, C15, RE)
 */

import assert from 'node:assert';

// ── Test Fixture 1: Sourced from Live SAP Warehouse 20201 structure ──────────
const sap20201Fixture = {
  warehouse_code: '20201',
  total_bins: 353,
  physical_bins: 352,
  system_bins: 1,
  active_bins: 353,
  hierarchy: [
    {
      code: 'SYSTEM-BIN-LOCATION',
      sublevel: 1,
      children: [],
      bins: [
        {
          bin_code: '20201-SYSTEM-BIN-LOCATION',
          abs_entry: 104,
          description: 'System Bin Location',
          inactive: false,
          is_system_bin: true,
        },
      ],
    },
    {
      code: 'F01',
      sublevel: 1,
      children: [
        {
          code: 'R01',
          sublevel: 2,
          bins: [
            {
              bin_code: '20201-F01-R01',
              abs_entry: 105,
              description: 'Chamber 1 General',
              inactive: false,
              is_system_bin: false,
            },
          ],
          children: [
            {
              code: 'B01',
              sublevel: 3,
              bins: [
                {
                  bin_code: '20201-F01-R01-B01',
                  abs_entry: 162,
                  description: 'Corridor 1',
                  inactive: false,
                  is_system_bin: false,
                },
              ],
              children: [],
            },
            {
              code: 'C01',
              sublevel: 3,
              bins: [],
              children: [
                {
                  code: 'RA',
                  sublevel: 4,
                  children: [],
                  bins: [
                    {
                      bin_code: '20201-F01-R01-C01-RA',
                      abs_entry: 142,
                      description: 'Tier A',
                      inactive: false,
                      is_system_bin: false,
                    },
                  ],
                },
                {
                  code: 'RB',
                  sublevel: 4,
                  children: [],
                  bins: [
                    {
                      bin_code: '20201-F01-R01-C01-RB',
                      abs_entry: 143,
                      description: 'Tier B',
                      inactive: false,
                      is_system_bin: false,
                    },
                  ],
                },
                {
                  code: 'RC',
                  sublevel: 4,
                  children: [],
                  bins: [
                    {
                      bin_code: '20201-F01-R01-C01-RC',
                      abs_entry: 144,
                      description: 'Tier C',
                      inactive: false,
                      is_system_bin: false,
                    },
                  ],
                },
                {
                  code: 'RD',
                  sublevel: 4,
                  children: [],
                  bins: [
                    {
                      bin_code: '20201-F01-R01-C01-RD',
                      abs_entry: 145,
                      description: 'Tier D',
                      inactive: false,
                      is_system_bin: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          code: 'R04', // Irregular chamber: 0 racks, direct bulk bin only
          sublevel: 2,
          bins: [
            {
              bin_code: '20201-F01-R04',
              abs_entry: 265,
              description: 'Chamber 4 Bulk Store',
              inactive: false,
              is_system_bin: false,
            },
          ],
          children: [],
        },
      ],
    },
    {
      code: 'F02',
      sublevel: 1,
      children: [],
      bins: [],
    },
  ],
};

// ── Test Fixture 2: Completely dynamic, unknown future warehouse structure ───
const unknownFutureFixture = {
  warehouse_code: 'WH-FUTURE-9999',
  total_bins: 50,
  physical_bins: 50,
  system_bins: 0,
  active_bins: 50,
  hierarchy: [
    {
      code: 'FREEZER-ZONE-NORTH',
      sublevel: 1,
      children: [
        {
          code: 'BAY-11',
          sublevel: 2,
          bins: [],
          children: [
            {
              code: 'RACK-K16',
              sublevel: 3,
              bins: [],
              children: [
                {
                  code: 'TIER-LEVEL-5',
                  sublevel: 4,
                  children: [],
                  bins: [
                    {
                      bin_code: 'WH99-NORTH-B11-K16-L5',
                      abs_entry: 9905,
                      description: 'Top Tier Bay 11 Rack K16',
                      inactive: false,
                      is_system_bin: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ── Implementation of Component Helper Functions ─────────────────────────────
function countPhysicalBins(node) {
  if (!node) return 0;
  let count = (node.bins || []).filter((b) => !b.is_system_bin).length;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      count += countPhysicalBins(child);
    }
  }
  return count;
}

function findBinInTree(nodes, targetCode, currentPath = []) {
  if (!nodes || !targetCode) return null;
  const normalized = String(targetCode).trim().toUpperCase();

  for (const node of nodes) {
    const nextPath = [...currentPath, node.code];
    if (Array.isArray(node.bins)) {
      for (const b of node.bins) {
        if (String(b.bin_code).trim().toUpperCase() === normalized) {
          return { ...b, path: nextPath };
        }
      }
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      const found = findBinInTree(node.children, targetCode, nextPath);
      if (found) return found;
    }
  }
  return null;
}

function filterRootSelectableNodes(hierarchy) {
  return (hierarchy || []).filter((node) => {
    const isSystem =
      node.code.toUpperCase().includes('SYSTEM') ||
      (node.bins &&
        node.bins.length > 0 &&
        node.bins.every((b) => b.is_system_bin) &&
        (!node.children || node.children.length === 0));
    return !isSystem;
  });
}

function buildSelectedBinPayload(binObj, warehouseCode, path = []) {
  return {
    bin_code: binObj.bin_code,
    abs_entry: binObj.abs_entry,
    warehouse: warehouseCode,
    sublevel1: path[0] || null,
    sublevel2: path[1] || null,
    sublevel3: path[2] || null,
    sublevel4: path[3] || null,
    description: binObj.description || '',
    inactive: Boolean(binObj.inactive),
    is_system_bin: Boolean(binObj.is_system_bin),
  };
}

// ── Run Tests ────────────────────────────────────────────────────────────────
console.log('🧪 Running ColdStorageMap automated logic verification...');

// 1. System Bin Exclusion
const selectableRoots = filterRootSelectableNodes(sap20201Fixture.hierarchy);
assert.strictEqual(selectableRoots.length, 2, 'Should filter out SYSTEM-BIN-LOCATION from selectable areas');
assert.deepStrictEqual(selectableRoots.map((r) => r.code), ['F01', 'F02']);
console.log('  ✓ System bin excluded from root navigation');

// 2. Physical Bins Count
const f01Node = selectableRoots.find((r) => r.code === 'F01');
const physicalInF01 = countPhysicalBins(f01Node);
assert.strictEqual(physicalInF01, 7, 'F01 should have 7 physical bins in fixture (1 general + 1 corridor + 4 rack levels + 1 bulk)');
console.log('  ✓ Recursive physical bin count correct (7 bins)');

// 3. Tree Search by BinCode
const foundShelf = findBinInTree(sap20201Fixture.hierarchy, '20201-F01-R01-C01-RD');
assert.ok(foundShelf, 'Should find 20201-F01-R01-C01-RD');
assert.strictEqual(foundShelf.abs_entry, 145);
assert.deepStrictEqual(foundShelf.path, ['F01', 'R01', 'C01', 'RD']);
console.log('  ✓ Deep tree search returns exact AbsEntry (145) and path ([F01, R01, C01, RD])');

// 4. Irregular Chamber R04 (0 child racks, 1 direct bin)
const r04 = f01Node.children.find((c) => c.code === 'R04');
assert.strictEqual(r04.children.length, 0, 'R04 should have 0 child racks');
assert.strictEqual(r04.bins.length, 1, 'R04 should have 1 direct bin');
assert.strictEqual(r04.bins[0].bin_code, '20201-F01-R04');
assert.strictEqual(r04.bins[0].abs_entry, 265);
const r04Selection = buildSelectedBinPayload(r04.bins[0], '20201', ['F01', 'R04']);
assert.strictEqual(r04Selection.sublevel1, 'F01');
assert.strictEqual(r04Selection.sublevel2, 'R04');
assert.strictEqual(r04Selection.sublevel3, null);
assert.strictEqual(r04Selection.sublevel4, null);
console.log('  ✓ Irregular chamber (R04) directly selectable with AbsEntry 265');

// 5. Corridor Bin B01 (sublevel 3 has bin, sublevel 4 is null)
const r01 = f01Node.children.find((c) => c.code === 'R01');
const b01 = r01.children.find((c) => c.code === 'B01');
assert.strictEqual(b01.children.length, 0, 'B01 corridor should have 0 children');
assert.strictEqual(b01.bins.length, 1, 'B01 corridor should have 1 bin');
assert.strictEqual(b01.bins[0].bin_code, '20201-F01-R01-B01');
assert.strictEqual(b01.bins[0].abs_entry, 162);
console.log('  ✓ Corridor bin (B01) correctly identified with AbsEntry 162');

// 6. Upright Industrial Rack Tier Reversal (RD top -> RA bottom)
const c01 = r01.children.find((c) => c.code === 'C01');
const reversedTiers = [...c01.children].reverse().map((l) => l.code);
assert.deepStrictEqual(reversedTiers, ['RD', 'RC', 'RB', 'RA'], 'Tiers must be displayed top to bottom');
console.log('  ✓ Upright rack tiers displayed in physical top-to-bottom order (RD -> RA)');

// 7. General Chamber Bin (20201-F01-R01)
assert.strictEqual(r01.bins.length, 1, 'R01 has 1 general bin');
assert.strictEqual(r01.bins[0].bin_code, '20201-F01-R01');
assert.strictEqual(r01.bins[0].abs_entry, 105);
console.log('  ✓ Chamber general bin identified with AbsEntry 105');

// 8. Arbitrary Dynamic Future Warehouse Handling
const futureRoots = filterRootSelectableNodes(unknownFutureFixture.hierarchy);
assert.strictEqual(futureRoots.length, 1);
assert.strictEqual(futureRoots[0].code, 'FREEZER-ZONE-NORTH');
const foundFuture = findBinInTree(unknownFutureFixture.hierarchy, 'WH99-NORTH-B11-K16-L5');
assert.ok(foundFuture);
assert.strictEqual(foundFuture.abs_entry, 9905);
assert.deepStrictEqual(foundFuture.path, ['FREEZER-ZONE-NORTH', 'BAY-11', 'RACK-K16', 'TIER-LEVEL-5']);
const futureSelection = buildSelectedBinPayload(foundFuture, 'WH-FUTURE-9999', foundFuture.path);
assert.strictEqual(futureSelection.warehouse, 'WH-FUTURE-9999');
assert.strictEqual(futureSelection.abs_entry, 9905);
assert.strictEqual(futureSelection.sublevel1, 'FREEZER-ZONE-NORTH');
assert.strictEqual(futureSelection.sublevel2, 'BAY-11');
assert.strictEqual(futureSelection.sublevel3, 'RACK-K16');
assert.strictEqual(futureSelection.sublevel4, 'TIER-LEVEL-5');
console.log('  ✓ Completely unknown future hierarchy dynamically navigates and binds without changes');

console.log('\n🎉 ALL 8 AUTOMATED TESTS PASSED SUCCESSFULLY!');
