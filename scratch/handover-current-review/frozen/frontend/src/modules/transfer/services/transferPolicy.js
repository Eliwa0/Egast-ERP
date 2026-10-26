// Preserve cold-storage hierarchy filtering without configuration dependencies.
export function filterPolicyHierarchy(nodes, allowedBins = null) {
  if (allowedBins === null) return nodes;
  const allowed = new Set(allowedBins);
  return (nodes || []).map((node) => ({ ...node,
    bins: (node.bins || []).filter((bin) => allowed.has(bin.bin_code)),
    children: filterPolicyHierarchy(node.children || [], allowedBins),
  })).filter((node) => node.bins.length || node.children.length);
}
