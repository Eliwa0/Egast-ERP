import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { canManageTransfer } from '../utils/roles';
import PageHeader from '../components/ui/PageHeader';
import SearchableSelect from '../components/ui/SearchableSelect';
import { shippingGet, shippingPost, saveShippingManifest } from '../services/shippingService';
import { getProductIcon } from '../utils/productIcon';
import '../styles/pages/shipping-loading.css';

const shippingStatus = (status, ar) => ({
  WAITING: ar ? 'بانتظار التحميل' : 'Waiting for loading',
  LOADING: ar ? 'جارٍ إعداد البيان' : 'Preparing manifest',
  READY: ar ? 'جاهزة للوزنة الثانية' : 'Ready for second weight',
  WEIGHED: ar ? 'جاهزة للدليفري' : 'Ready for delivery',
  DELIVERY_CREATED: ar ? 'تم إنشاء مسودة الدليفري' : 'Delivery draft created',
}[status] || status);

export default function ShippingLoadingPage() {
  const { lang } = useI18n();
  const { user } = useAuth();
  const ar = lang === 'ar';
  const [operations, setOperations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [orders, setOrders] = useState([]);
  const [order, setOrder] = useState(null);
  const [elements, setElements] = useState([]);
  const [pallets, setPallets] = useState([]);
  const [container, setContainer] = useState('');
  const [scan, setScan] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const [nextOffset, setNextOffset] = useState(null);
  const [orderOffset, setOrderOffset] = useState(null);
  const [step, setStep] = useState(0);
  const scanRef = useRef(null);
  const stepbarRef = useRef(null);
  const editable = selected && ['WAITING', 'LOADING'].includes(selected.status);
  useEffect(() => {
    if (window.matchMedia('(max-width: 768px)').matches) stepbarRef.current?.querySelector('.wizard-step--active')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [step]);
  const errorText = (err) => {
    const data = err.response?.data;
    if (data?.code === 'PENDING_SAP_TRANSFER') {
      const references = (data.pending_transfers || []).map((row) => `#${row.transfer_id}`).join(', ');
      return ar ? `البالتة ${data.batch_number} عليها طلبات تحويل SAP معلّقة: ${references}. راجع طلبات التحويل أولًا؛ البيان لم يُرسل للميزان.` : `Pallet ${data.batch_number} has pending SAP transfers: ${references}. Resolve them in Transfer Review first. The manifest was not sent to the scale.`;
    }
    return data?.error || err.message;
  };

  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try {
      await shippingPost('operations/discover/');
      const [data, catalog, available] = await Promise.all([shippingGet('operations/'), shippingGet('elements/'), shippingGet('orders/')]);
      setOperations(data.operations || []); setNextOffset(data.next_offset);
      setElements(catalog.elements || []);
      setOrders(available.orders || []); setOrderOffset(available.next_offset);
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (selected || busy || operations.length > 50) return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const data = await shippingGet('operations/');
        if (active) { setOperations(data.operations || []); setNextOffset(data.next_offset); }
      } catch { /* Manual refresh reports connection errors. */ }
    }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selected, busy, operations.length]);

  const applyOperation = (op) => {
    setSelected(op); setOrder((current) => op.order?.doc_entry ? op.order : current);
    setPallets(op.pallets || []); setContainer(op.container_number || op.containers?.[0] || '');
    setScan(''); setDirty(false);
  };
  const open = async (id) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await shippingGet(`operations/${id}/`);
      if (data.operation.sales_order_doc_entry && Number(data.operation.sales_order_doc_entry) !== Number(order?.doc_entry)) throw new Error(ar ? 'العربية مرتبطة بأوردر آخر. اختار عربية متاحة لهذا الأوردر.' : 'Truck is assigned to another order.');
      applyOperation(data.operation);
      setStep(['WAITING', 'LOADING'].includes(data.operation.status) ? 2 : 4);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const selectOrder = async (entry) => {
    setBusy(true); setError('');
    try {
      const data = await shippingGet(`orders/${entry}/`);
      setOrder(data.order); setSelected(null); setPallets([]); setSearch(''); setDirty(false); setMessage('');
      setStep(1);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const addPallet = async (event) => {
    event.preventDefault();
    if (busy || !scan.trim() || !order) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { source } = await shippingGet(`sources/${encodeURIComponent(scan.trim())}/`);
      if (pallets.some((p) => p.batch_number === source.batch_number)) throw new Error(ar ? 'البالتة موجودة بالفعل في البيان.' : 'Pallet already in manifest.');
      const matching = order.lines.filter((line) => line.item_code === source.item_code);
      if (!matching.length) throw new Error(ar ? 'صنف البالتة غير موجود في الأوردر.' : 'Pallet item is not on this order.');
      setPallets((rows) => [...rows, { ...source, order_line_number: matching[0].line_number,
        item_name: matching[0].item_name, uom: matching[0].uom, box_count: '', pallet_element_id: '', box_element_id: '' }]);
      setScan(''); setDirty(true);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); scanRef.current?.focus(); }
  };
  const update = (index, key, value) => {
    setPallets((rows) => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
    setDirty(true); setMessage('');
  };
  const save = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const { operation } = await saveShippingManifest(selected.id, { revision: selected.revision,
        sales_order_doc_entry: order.doc_entry, container_number: container, pallets });
      applyOperation(operation); setMessage(ar ? 'تم حفظ البيان. راجعه ثم أرسله للباسكول.' : 'Manifest saved. Review and send to scale.');
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const action = async (name) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const { operation } = await shippingPost(`operations/${selected.id}/${name}/`, { revision: selected.revision });
      applyOperation(operation); setMessage(name === 'submit' ? (ar ? 'تم تسجيل تحميل المرحلة 5 وإرسال البيان للباسكول.' : 'Stage 5 loading recorded. Manifest sent to scale.') : (ar ? 'تم فتح البيان. الوزنة الثانية متوقفة لحين إعادة الإرسال.' : 'Manifest reopened. Second weight blocked until resubmission.'));
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const more = async (type) => {
    setBusy(true); setError('');
    try {
      const data = await shippingGet(type === 'orders' ? 'orders/' : 'operations/', { offset: type === 'orders' ? orderOffset : nextOffset });
      if (type === 'orders') { setOrders((rows) => [...rows, ...data.orders]); setOrderOffset(data.next_offset); }
      else { setOperations((rows) => [...rows, ...data.operations]); setNextOffset(data.next_offset); }
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const summary = useMemo(() => {
    const groups = new Map();
    for (const p of pallets) {
      const group = groups.get(p.order_line_number) || { item: p.item_name || p.item_code, pallets: 0, boxes: 0, quantity: 0, uom: p.uom };
      group.pallets += 1; group.boxes += Number(p.box_count) || 0; group.quantity += Number(p.quantity) || 0;
      groups.set(p.order_line_number, group);
    }
    return [...groups.values()];
  }, [pallets]);
  const completePackaging = pallets.length > 0 && pallets.every((p) => p.pallet_element_id && p.box_element_id && Number.isInteger(Number(p.box_count)) && Number(p.box_count) > 0 && Number(p.box_count) <= 100000);
  const elementSelect = (p, index, key, label) => {
    const isPallet = key === 'pallet_element_id';
    const count = isPallet ? 1 : p.box_count;
    const element = elements.find((e) => String(e.id) === String(p[key]));
    const weight = !editable ? Number(isPallet ? p.pallet_unit_weight : p.box_unit_weight) : Number(element?.weight || 0);
    return <div className="shipping-element-row">
      <div className="shipping-element-field"><span>{label}</span><SearchableSelect aria-label={label} value={String(p[key] || '')} disabled={!editable || busy} onChange={(value) => update(index, key, value)} options={elements.map((e) => ({ value: String(e.id), label: `${e.name} (${Number(e.weight).toFixed(2)} KG)` }))} placeholder={ar ? '-- اختر عنصرًا مؤثرًا --' : '-- Select an element --'} /></div>
      <label>{ar ? 'العدد / الكمية' : 'Count / quantity'}<input aria-label={`${label}: ${ar ? 'العدد' : 'count'}`} type="number" min="1" max="100000" step="1" value={count} readOnly={isPallet} disabled={!editable || busy} onChange={(event) => update(index, 'box_count', event.target.value)} /></label>
      <div className="shipping-element-total"><small>{ar ? 'إجمالي الخصم' : 'Total deduction'}</small><strong>{(weight * (Number(count) || 0)).toFixed(2)} KG</strong></div>
    </div>;
  };
  const stepLabels = ar ? ['الأوردر', 'العربية والحاوية', 'التسكين', 'العناصر المؤثرة', 'المراجعة والإرسال'] : ['Order', 'Truck / container', 'Loading', 'Packaging deductions', 'Review / send'];
  const canNext = step === 0 ? !!order : step === 1 ? !!selected && !!container : step === 2 ? pallets.length > 0 : step === 3 ? completePackaging : false;
  const deduction = pallets.reduce((total, p) => {
    const unitWeight = (key, snapshot) => !editable ? Number(p[snapshot] || 0) : Number(elements.find((e) => String(e.id) === String(p[key]))?.weight || 0);
    return total + unitWeight('pallet_element_id', 'pallet_unit_weight') + unitWeight('box_element_id', 'box_unit_weight') * (Number(p.box_count) || 0);
  }, 0);

  return <div className="page-shell shipping-loading" dir={ar ? 'rtl' : 'ltr'}>
    <PageHeader title={ar ? 'الشحن / تحميل الحاويات' : 'Shipping / Container loading'} description={ar ? 'عربيات وزنت فارغ — إعداد بيان التحميل وإرساله للباسكول' : 'Empty-weighed trucks — prepare loading manifest and send to scale'} />
    {error && <div className="shipping-error" role="alert">{error}</div>}
    {message && <div className="shipping-success" role="status">{message}</div>}
    <div className="receipt-wizard"><div className="wizard-stepbar-wrap" ref={stepbarRef} aria-label={ar ? 'خطوات الشحن' : 'Shipping steps'}>{stepLabels.map((label, index) => <React.Fragment key={label}><div role="button" className={`wizard-step ${index === step ? 'wizard-step--active' : ''} ${index < step ? 'wizard-step--done' : ''} ${index <= step && !busy ? 'wizard-step--clickable' : 'wizard-step--locked'}`} tabIndex={index <= step && !busy ? 0 : -1} aria-disabled={busy || index > step || (index < 2 && (dirty || selected?.pallets?.some((p) => p.loaded) || (selected && !editable)))} onClick={() => { if (!busy && index <= step && !(index < 2 && (dirty || selected?.pallets?.some((p) => p.loaded) || (selected && !editable)))) setStep(index); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } }} aria-current={step === index ? 'step' : undefined}><span className="wizard-step__circle">{index < step ? '✓' : ['📦', '🚚', '🏷️', '⚖️', '📋'][index]}</span><span className="wizard-step__label">{label}</span></div>{index < stepLabels.length - 1 && <div className={`wizard-connector ${index < step ? 'wizard-connector--done' : ''}`} />}</React.Fragment>)}</div></div>
    {step === 0 ? <section className="card-panel">
      <h2>{ar ? 'الأوردرات المفتوحة — اختار الأوردر أولًا' : 'Open orders — choose an order first'}</h2>
      <div className="shipping-actions"><label>{ar ? 'بحث بالأوردر أو العميل' : 'Search order or customer'}<input value={search} onChange={(event) => setSearch(event.target.value)} /></label><button disabled={busy} onClick={refresh}>{ar ? 'تحديث' : 'Refresh'}</button></div>
      {busy && <p role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}
      {!busy && !orders.length && <p>{ar ? 'لا توجد أوردرات مفتوحة متاحة.' : 'No open orders available.'}</p>}
      <div className="shipping-cards">{orders.filter((o) => `${o.doc_num} ${o.customer_name}`.toLowerCase().includes(search.toLowerCase())).map((o) => <button className="shipping-card" key={o.doc_entry} disabled={busy} onClick={() => selectOrder(o.doc_entry)}><span>{ar ? 'سيلز أوردر' : 'Sales order'}</span><h2>#{o.doc_num}</h2><strong>{o.customer_name}</strong><span>{ar ? 'اختيار الأوردر ←' : 'Select order →'}</span></button>)}</div>
      {orderOffset !== null && <button disabled={busy} onClick={() => more('orders')}>{ar ? 'المزيد من الأوردرات' : 'More orders'}</button>}
      {operations.some((op) => op.order?.doc_entry) && <section className="shipping-ticket"><h3>{ar ? 'متابعة بيان تحميل قائم' : 'Resume an existing manifest'}</h3><div className="shipping-cards">{operations.filter((op) => op.order?.doc_entry).map((op) => <button key={op.id} disabled={busy} onClick={() => { applyOperation(op); setStep(4); }}>#{op.order.doc_num} · {op.vehicle_number} · {shippingStatus(op.status, ar)}</button>)}</div></section>}
    </section> : <>
    {order && <section className="shipping-ticket"><h2>{ar ? 'الأوردر المختار' : 'Selected order'}: #{order.doc_num}</h2><strong>{order.customer_name}</strong>{step === 1 && <div className="shipping-cards">{(order.lines || []).map((line) => <div className="shipping-order-line" key={line.line_number}><strong>{line.item_name || line.item_code}</strong><span>{ar ? 'الكمية المتبقية' : 'Open quantity'}: {line.open_quantity} {line.uom}</span></div>)}</div>}{!selected && <button disabled={busy} onClick={() => { setOrder(null); setSearch(''); setStep(0); }}>{ar ? 'اختيار أوردر آخر' : 'Choose another order'}</button>}</section>}
    {step === 1 ? <>
      <h2>{ar ? 'اختار العربية بالحاوية للأوردر المحدد' : 'Choose the truck and container for this order'}</h2>
      <div className="shipping-actions"><label>{ar ? 'بحث بالعربية أو الحاوية أو التذكرة' : 'Search truck, container or ticket'}<input value={search} onChange={(event) => setSearch(event.target.value)} /></label><button disabled={busy} onClick={refresh}>{ar ? 'تحديث القائمة' : 'Refresh'}</button></div>
      {busy && <p role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}
      {!busy && !operations.length && <p>{ar ? 'لا توجد عربيات حاويات سجلت وزنة فارغ بعد.' : 'No empty-weighed container trucks yet.'}</p>}
      <div className="shipping-cards">{operations.filter((op) => (!op.sales_order_doc_entry && ['WAITING', 'LOADING'].includes(op.status)) || Number(op.sales_order_doc_entry) === Number(order?.doc_entry)).filter((op) => `${op.vehicle_number} ${op.container_number} ${op.ticket_number}`.toLowerCase().includes(search.toLowerCase())).map((op) => <button className="shipping-card" key={op.id} disabled={busy} onClick={() => open(op.id)}>
        <span className={`shipping-status shipping-status--${op.status}`}>{shippingStatus(op.status, ar)}</span>
        <h2>{op.vehicle_number || '—'}</h2><span>{ar ? 'الحاوية' : 'Container'}: {op.container_number || '—'}</span>
        <span>{ar ? 'السائق' : 'Driver'}: {op.driver_name || '—'}</span><span>{ar ? 'تذكرة الميزان' : 'Scale ticket'}: {op.ticket_number}</span>
        <span>{ar ? 'وزنة الفارغ' : 'Empty weight'}: {op.first_weight} kg</span>
        <strong>{op.pallet_count} {ar ? 'بالتة' : 'pallets'} · {op.box_count} {ar ? 'صندوق' : 'boxes'}</strong>
      </button>)}</div>
      {nextOffset !== null && <button disabled={busy} onClick={() => more('operations')}>{ar ? 'المزيد من العربيات' : 'More trucks'}</button>}
    </> : selected && <>
      <div className="shipping-ticket"><h2>{selected.vehicle_number} · {container || '—'}</h2><span>{selected.ticket_number} — {shippingStatus(selected.status, ar)}</span><p>{ar ? 'وزنة الفارغ' : 'Empty weight'}: {selected.first_weight} kg</p></div>
      {step === 2 && <><div className="shipping-fields">
        <label>{ar ? 'الحاوية المسجلة عند الدخول' : 'Container recorded at entry'}<select value={container} disabled={!editable || busy || selected.pallets.some((p) => p.loaded)} onChange={(event) => { setContainer(event.target.value); setDirty(true); }}>
          <option value="">{ar ? 'اختر الحاوية' : 'Select container'}</option>{[...new Set([selected.container_number, ...(selected.containers || [])].filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}
        </select></label>
      </div>
      <section className="shipping-section">
      <h2>{ar ? 'تسكين البالتات في الحاوية' : 'Load pallets into the container'}</h2>
      {editable && order && <form className="shipping-scan" onSubmit={addPallet}>
        <label>{ar ? 'امسح باركود البالتة' : 'Scan pallet barcode'}<input ref={scanRef} value={scan} autoComplete="off" dir="ltr" onChange={(event) => setScan(event.target.value)} disabled={busy} /></label>
        <button className="shipping-primary" disabled={busy || !scan.trim()}>{ar ? 'إضافة البالتة' : 'Add pallet'}</button>
      </form>}
      <div className="shipping-pallets">{pallets.map((p, i) => <article className="shipping-pallet" key={p.batch_number}>
        <h3>{i + 1}. <span className="meta-label-icon" aria-hidden="true">{getProductIcon(p.item_name || p.item_code)}</span> {p.item_name || p.item_code}</h3><strong dir="ltr">{p.batch_number}</strong>
        <p>{ar ? 'نوع بالتة الإنتاج' : 'Production pallet type'}: {p.without_pallet ? (ar ? 'بدون بالتات' : 'No pallets') : p.production_pallet_type_name || '—'}</p>
        <div className="shipping-fields">
          <label>{ar ? 'بند الأوردر' : 'Order line'}<select value={p.order_line_number} disabled={!editable || busy || p.loaded} onChange={(event) => update(i, 'order_line_number', Number(event.target.value))}>
            {(order?.lines || []).filter((l) => l.item_code === p.item_code).map((l) => <option key={l.line_number} value={l.line_number}>{l.line_number + 1} — {l.item_name} ({ar ? 'المتبقي' : 'Open'}: {l.open_quantity} {l.uom})</option>)}
          </select></label>
          <label>{ar ? 'كمية الصنف من البالتة' : 'Pallet item quantity'}<input value={p.quantity} readOnly /><small>{p.uom} — {ar ? 'من سجل البالتة؛ ليست توزيعًا لوزن الحاوية' : 'From pallet record; not allocated container weight'}</small></label>
        </div>
        {editable && !p.loaded && <button disabled={busy} onClick={() => { setPallets((rows) => rows.filter((_, index) => index !== i)); setDirty(true); }}>{ar ? 'حذف من البيان' : 'Remove from manifest'}</button>}
      </article>)}</div>
      {!pallets.length && <p className="shipping-empty">{ar ? 'امسح باركود كل بالتة لتسكينها. عدد البالتات لكل صنف بيتجمع تلقائيًا.' : 'Scan each pallet to load it. Pallet counts per item are calculated automatically.'}</p>}
      </section></>}
      {step === 3 && <section className="shipping-section"><h2>{ar ? '📦 العناصر المؤثرة (الطبالي / الصناديق)' : '📦 Packaging deductions (pallets / boxes)'}</h2><p>{ar ? 'اختر العنصر وأدخل العدد لحساب خصم الوزن تلقائيًا.' : 'Select an element and enter its count to calculate the deduction.'}</p>
      {!pallets.length && <p className="shipping-empty">{ar ? 'البالتات المسكنة هتظهر هنا لإدخال نوع البالتة ونوع الصندوق وعدد الصناديق.' : 'Loaded pallets appear here to enter pallet type, box type and box count.'}</p>}
      {pallets.map((p, i) => <article className="shipping-pallet" key={p.batch_number}><h3>{i + 1}. <span className="meta-label-icon" aria-hidden="true">{getProductIcon(p.item_name || p.item_code)}</span> {p.item_name || p.item_code}</h3><strong dir="ltr">{p.batch_number}</strong><div>
          {elementSelect(p, i, 'pallet_element_id', ar ? 'نوع البالتة' : 'Pallet type')}
          {elementSelect(p, i, 'box_element_id', ar ? 'نوع الصندوق' : 'Box type')}
      </div></article>)}
      <div className="shipping-element-total"><small>{ar ? 'إجمالي خصم العناصر المؤثرة' : 'Total packaging deduction'}</small><strong>{deduction.toFixed(2)} KG</strong></div>
      </section>}
      {step === 4 && <>
      {summary.length > 0 && <section className="shipping-ticket"><h3>{ar ? 'ملخص الأصناف المحمّلة' : 'Loaded item summary'}</h3>{summary.map((s, i) => <p key={i}><strong><span className="meta-label-icon" aria-hidden="true">{getProductIcon(s.item)}</span> {s.item}</strong>: {s.pallets} {ar ? 'بالتة' : 'pallets'} · {s.boxes} {ar ? 'صندوق' : 'boxes'} · {s.quantity} {s.uom}</p>)}</section>}
      <section className="shipping-ticket"><h3>{ar ? 'مراجعة العناصر المؤثرة' : 'Review packaging deductions'}</h3>{pallets.map((p) => <p key={p.batch_number}><bdi>{p.batch_number}</bdi> — {elements.find((e) => String(e.id) === String(p.pallet_element_id))?.name || p.pallet_type} × 1 · {elements.find((e) => String(e.id) === String(p.box_element_id))?.name || p.box_type} × {p.box_count}</p>)}<strong>{ar ? 'إجمالي الخصم' : 'Total deduction'}: {deduction.toFixed(2)} KG</strong></section>
      {selected.net_weight && <p>{ar ? 'صافي الحاوية الإجمالي' : 'Total container net weight'}: <strong>{selected.net_weight} kg</strong></p>}
      <div className="shipping-actions shipping-actions--sticky">
        {editable && dirty && <button disabled={busy} onClick={() => open(selected.id)}>{ar ? 'تجاهل التغييرات' : 'Discard changes'}</button>}
        {editable && <><button disabled={busy || !order || !completePackaging} onClick={save}>{ar ? 'حفظ البيان' : 'Save manifest'}</button>
          <button className="shipping-primary" disabled={busy || dirty || selected.status !== 'LOADING'} onClick={() => action('submit')}>{ar ? 'إنهاء التحميل وإرسال للباسكول' : 'Complete loading and send to scale'}</button></>}
        {selected.status === 'READY' && canManageTransfer(user) && <button disabled={busy} onClick={() => action('reopen')}>{ar ? 'إعادة فتح البيان للتصحيح' : 'Reopen manifest for correction'}</button>}
        {dirty && <span role="status">{ar ? 'توجد تغييرات تحتاج للحفظ.' : 'Unsaved changes.'}</span>}
      </div>
      </>}
    </>}
    <div className="shipping-actions shipping-wizard-navigation">
      {step > 0 && <button disabled={busy || (step <= 2 && (dirty || selected?.pallets?.some((p) => p.loaded) || (selected && !editable)))} onClick={() => setStep(step - 1)}>{ar ? 'السابق' : 'Previous'}</button>}
      {step < 4 && <button className="shipping-primary" disabled={busy || !canNext} onClick={() => setStep(step + 1)}>{ar ? 'التالي' : 'Next'}</button>}
    </div>
    </>}
  </div>;
}
