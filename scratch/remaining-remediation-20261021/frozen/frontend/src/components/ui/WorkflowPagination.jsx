import { useI18n } from '../../contexts/I18nContext';

export default function WorkflowPagination({ paging, loading, countsOnPage = false }) {
  const { t } = useI18n();
  const { info, params, setOffset } = paging;
  if (!info) return null;
  return <nav aria-label={t('customizationDelivery.pagination')} className="workflow-pagination">
    {countsOnPage && <small>{t('customizationDelivery.pageCounts')}</small>}
    <button type="button" className="app-button app-button--secondary" disabled={loading || params.offset === 0}
      onClick={() => setOffset(Math.max(0, params.offset - params.page_size))}>{t('common.previous')}</button>
    <span>{Math.min(params.offset + 1, info.total)}–{Math.min(params.offset + params.page_size, info.total)} / {info.total}</span>
    <button type="button" className="app-button app-button--secondary" disabled={loading || !info.has_more}
      onClick={() => setOffset(params.offset + params.page_size)}>{t('common.next')}</button>
  </nav>;
}
