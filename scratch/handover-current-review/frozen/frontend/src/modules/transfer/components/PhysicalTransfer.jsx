import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../contexts/I18nContext';
import { fetchPhysicalEvents } from '../services/transferService';


export function PhysicalTransferReview() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setBusy(true); setError('');
      try {
        const result = await fetchPhysicalEvents(offset);
        if (!Array.isArray(result?.events) || result.events.some(row => !row || typeof row !== 'object')) throw new Error('Invalid physical transfer response');
        if (!cancelled) setData(result);
      } catch (err) { if (!cancelled) setError(err.response?.data?.error || t('physicalTransfer.loadFailed')); }
      finally { if (!cancelled) setBusy(false); }
    });
    return () => { cancelled = true; };
  }, [offset, refresh, t]);
  const loads = (data?.events || []).filter(row => row.stage === 5);
  return <section className="card-panel tr-workflow-card" aria-labelledby="shipping-loading-title">
    <div className="tr-workflow-card__header"><div>
      <span className="section-kicker">{t('transferReview.stage5')}</span>
      <h2 id="shipping-loading-title">{t('physicalTransfer.shippingLoading')}</h2>
      <p>{t('physicalTransfer.shippingDescription')}</p>
    </div>
    <button type="button" className="app-button app-button--secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{t('transferReview.refresh')}</button>
    </div>
    {busy || (!data && !error) ? <p role="status">{t('common.loading')}</p> : error ? <div role="alert" className="feedback-message feedback-message--error">{error}</div>
      : !loads.length ? <p className="rr-grid-empty">{t('physicalTransfer.empty')}</p> : <div className="rr-grid-scroll">
        <table className="tr-workflow-table"><thead><tr>
          {['batch', 'sourceWarehouse', 'container', 'state', 'loadedBy', 'loadedAt', 'reference'].map(key => <th key={key}>{key === 'batch' ? t('transferReview.batch') : t(`physicalTransfer.${key}`)}</th>)}
        </tr></thead><tbody>{loads.map(row => <tr key={row.reference || row.id}>
          <td><bdi>{row.batch_number || '-'}</bdi></td><td><bdi>{row.source_location || '-'}</bdi></td>
          <td><bdi>{row.container_number || '-'}</bdi></td>
          <td><span className="rr-status-badge rr-status-badge--POSTED">{row.state === 'LOADED_TO_CONTAINER' ? t('physicalTransfer.LOADED_TO_CONTAINER') : row.state || '-'}</span></td><td>{row.actor || '-'}</td>
          <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td><td>{row.reference || '-'}</td>
        </tr>)}</tbody></table>
      </div>}
    <p className="tr-workflow-card__note">{t('physicalTransfer.shippingScope')}</p>
    <div className="tr-workflow-card__footer">
    <button type="button" className="app-button app-button--secondary" disabled={busy || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>{t('physicalTransfer.previous')}</button>
    <button type="button" className="app-button app-button--secondary" disabled={busy || error || data?.next_offset == null} onClick={() => setOffset(data.next_offset)}>{t('physicalTransfer.next')}</button>
    </div>
  </section>;
}
