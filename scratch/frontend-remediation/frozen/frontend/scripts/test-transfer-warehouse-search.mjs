// Exercise the real shared selector's contracts without live API or SAP writes.
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const f = globalThis.__warehouseSearchTest = { states: [], lang: 'en', rows: [] };
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, plugins: [{
  name: 'warehouse-selector-contract', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:warehouse-hooks' || id === 'virtual:warehouse-autocomplete') return '\0' + id; },
  load(id) {
    if (id === '\0virtual:warehouse-autocomplete') return `export default function Autocomplete(props) { globalThis.__warehouseSearchTest.props = props; return null; }`;
    if (id === '\0virtual:warehouse-hooks') return `
      export function useState(initial) { const f = globalThis.__warehouseSearchTest, i = f.index++;
        if (!(i in f.states)) f.states[i] = typeof initial === 'function' ? initial() : initial;
        return [f.states[i], next => { f.states[i] = typeof next === 'function' ? next(f.states[i]) : next; }]; }
      export const useRef = initial => useState({ current: initial })[0];
      export const useEffect = () => {};
    `;
  },
  transform(code, id) {
    if (id.endsWith('/contexts/I18nContext.jsx')) return `export const useI18n = () => ({ lang: globalThis.__warehouseSearchTest.lang,
      t: key => key === 'searchControl.searchWarehouses' ? (globalThis.__warehouseSearchTest.lang === 'ar' ? 'ابحث عن المخازن...' : 'Search warehouses...') : key });`;
    if (id.endsWith('/hooks/useRemoteOptions.js')) return `export default function useRemoteOptions(source, input, config) {
      const f = globalThis.__warehouseSearchTest; f.remote = { source, input, config };
      return { rows: f.rows, loading: false, error: false, retry() {}, loadMore() {} }; }`;
    if (id.endsWith('/components/ui/SearchableSelect.jsx')) return code
      .replace("from '@mui/material/Autocomplete'", "from 'virtual:warehouse-autocomplete'")
      .replace('useEffect, useId, useMemo, useRef, useState', 'useId, useMemo')
      + "\nimport {useState, useRef, useEffect} from 'virtual:warehouse-hooks';";
  },
}] });
try {
  const { default: Select } = await server.ssrLoadModule('/src/components/ui/SearchableSelect.jsx');
  const children = [
    React.createElement('option', { value: '90214', 'data-search': 'مخزن موالح' }, '90214 - Internal Intermediate'),
    React.createElement('option', { value: '90215' }, '90215 - وسيط داخلي'),
    React.createElement('option', { value: '20201' }, '20201 - Cold Storage'),
  ];
  let selected = '20201';
  let changes = [];
  function render(extra = {}) {
    f.index = 0;
    renderToString(React.createElement(Select, { children, value: selected, searchInDropdown: true,
      onChange: event => { selected = event.target.value; changes.push(selected); }, ...extra }));
    return f.props;
  }
  let p = render();
  assert.equal(p.inputValue, '20201 - Cold Storage');
  p.onOpen({}); p = render();
  assert.equal(p.options.length, 3);
  for (const [query, expected] of [['90214', ['90214']], ['موالح', ['90214']], ['وسيط', ['90215']], ['cOLD', ['20201']]]) {
    p.slotProps.paper.onSearchChange(query); p = render();
    assert.equal(p.inputValue, query);
    assert.deepEqual(p.filterOptions(p.options, { inputValue: p.inputValue }).map(option => option.value), expected);
    assert.equal(f.remote.source, undefined); // Already loaded lists stay local.
  }
  const popup = renderToString(React.createElement(p.slots.paper, { ...p.slotProps.paper, children: React.createElement('ul', null, 'options') }));
  assert.ok(popup.includes('type="search"')); assert.ok(popup.includes('Search warehouses...')); assert.ok(popup.includes('<ul>options</ul>'));
  const keys = []; let originalRefNode;
  const input = { ownerDocument: { defaultView: { KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } } } },
    dispatchEvent: event => keys.push(event) };
  const inputField = p.renderInput({ slotProps: { htmlInput: { ref: node => { originalRefNode = node; } } } });
  inputField.props.slotProps.htmlInput.ref(input);
  assert.equal(originalRefNode, input); // Keep MUI's original ref/keyboard machinery.
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    let prevented = false;
    p.slotProps.paper.onSearchKeyDown({ key, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
  }
  p.slotProps.paper.onSearchKeyDown({ key: 'a' });
  p.slotProps.paper.onSearchKeyDown({ key: 'Enter', nativeEvent: { isComposing: true } });
  assert.deepEqual(keys.map(event => event.key), ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']);
  assert.ok(keys.every(event => event.bubbles && event.cancelable));
  p.onClose({ relatedTarget: { closest: () => true } }, 'blur'); p = render(); assert.equal(p.open, true);
  p.onChange({}, p.options[0]); p.onClose({}, 'selectOption'); p = render();
  assert.deepEqual(changes, ['90214']); assert.equal(p.value.value, '90214'); assert.equal(p.inputValue, '90214 - Internal Intermediate');
  p.onOpen({}); p = render(); assert.equal(p.inputValue, ''); assert.equal(p.value.value, '90214');
  p.slotProps.paper.onSearchBlur({ relatedTarget: null }); p = render(); assert.equal(p.open, false);
  f.lang = 'ar'; p = render(); assert.equal(p.slotProps.paper.searchDirection, 'rtl');
  assert.equal(p.slotProps.paper.searchPlaceholder, 'ابحث عن المخازن...');

  // Rules retains its existing paginated remote source and multi-value contract.
  f.states = []; f.rows = [{ code: '90214', name: 'وسيط موالح' }, { code: '20201', name: 'Cold Storage' }];
  const source = { endpoint: '/warehouses/', browse: true, mapOption: row => ({ value: row.code, label: `${row.code} - ${row.name}` }) };
  let values = ['20201'];
  const remoteProps = () => ({ options: [], searchSource: source, multiple: true, value: values,
    selectedOptions: [{ value: '20201', label: '20201 - Cold Storage' }], onChange: next => { values = next; } });
  p = render(remoteProps()); p.onOpen({}); p = render(remoteProps());
  p.slotProps.paper.onSearchChange('موالح'); p = render(remoteProps());
  assert.equal(f.remote.input, 'موالح'); assert.equal(f.remote.source, source);
  assert.deepEqual(p.filterOptions(p.options, { inputValue: 'موالح' }), p.options); // API owns remote filtering.
  p.onChange({}, p.options); p = render(remoteProps());
  assert.deepEqual(values, ['90214', '20201']);
  f.rows = []; p = render(remoteProps());
  assert.deepEqual(p.value.map(option => option.value), values);
  assert.equal(p.value[0].label, '90214 - وسيط موالح');
  const longLabel = `90214 - وسيط داخلي موالح ${'اسم عربي طويل '.repeat(12)}`;
  const selectedMarkup = renderToString(p.renderValue([{ value: '90214', label: longLabel }]));
  assert.ok(selectedMarkup.includes('<bdi dir="ltr"'));
  assert.ok(selectedMarkup.includes('searchable-select__desc-bdi'));
  assert.ok(selectedMarkup.includes(longLabel)); // Tooltip retains the full name.
  assert.equal(p.renderInput({ slotProps: { htmlInput: {} } }).props.placeholder, '');
  f.states = []; p = render({ searchInDropdown: false }); assert.equal(p.slots, undefined);
  console.log('PASS: dropdown search header, code/name/Arabic matching, case-insensitive local filtering, selection retention, multi-select, popup focus/close, RTL, unchanged remote search and default consumers.');
} finally { await server.close(); delete globalThis.__warehouseSearchTest; }
