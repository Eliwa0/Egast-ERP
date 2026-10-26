import { Children, isValidElement } from 'react';

export function nodeToText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join('');
  if (isValidElement(node)) return nodeToText(node.props.children);
  return String(node);
}

export function optionsFromChildren(children) {
  return Children.toArray(children).filter(isValidElement).map((child) => {
    const rawValue = child.props.value ?? nodeToText(child.props.children);
    return { value: String(rawValue), label: nodeToText(child.props.children).trim() || String(rawValue), disabled: Boolean(child.props.disabled),
      ...(child.props['data-search'] ? { searchText: child.props['data-search'] } : {}) };
  });
}

export function optionsFromProp(options = []) {
  return options.map((option) => {
    const value = String(option.value ?? option.id ?? '');
    return { ...option, value, label: nodeToText(option.label ?? option.name ?? value).trim() || value, disabled: Boolean(option.disabled) };
  });
}
