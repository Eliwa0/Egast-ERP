import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import PrintDocumentBarcode from '../components/print/PrintDocumentBarcode';
import { loadCompletedPurchaseQuotations } from '../services/purchaseQuotationService';
import { openBlankPrintWindow, writePrintDocument } from '../utils/printDocument';
import { prepareShippingReceivingPrintRecord } from '../utils/shippingReceivingPrintIdentifiers';
import egastLogo from '../assets/logos/egast-logo.png';
import { ViewActionButton, PrintActionButton } from '../components/ui/ActionIconButton';
import '../styles/pages/quality-inspection.css';

const SHIPPING_PRINT_SYSTEM_TERMS = /Goods Receipt PO|Purchase Quotation|SAP B1 Operations|SAP POSTED|SAP B1|DocEntry|GRPO/gi;

const getShippingPrintRemark = (value) => String(value || '')
  .replace(SHIPPING_PRINT_SYSTEM_TERMS, '')
  .replace(/^[\s:|/\-–—]+|[\s:|/\-–—]+$/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

function ShippingPrintRemark({ value, label = 'ملاحظات الشحن:', wide = false }) {
  const printableRemark = getShippingPrintRemark(value);
  if (!printableRemark || printableRemark === '-') return null;

  return (
    <div className="info-cell" style={wide ? { gridColumn: 'span 2' } : undefined}>
      <span className="cell-lbl">{label}</span>{' '}
      <strong>{printableRemark}</strong>
    </div>
  );
}

function PurchaseQuotationReviewPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const toast = useToast();

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // Print state
  const [printingRecordsList, setPrintingRecordsList] = useState([]);
  const [printRequest, setPrintRequest] = useState(null);
  const printContainerRef = useRef(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadCompletedPurchaseQuotations(search);
      setRecords(data);
    } catch (err) {
      console.error('Failed to load completed Purchase Quotations:', err);
      const msg = err.response?.data?.error || t('purchaseQuotation.errorLoading');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [search, t, toast]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handlePrintSingle = async (record) => {
    const printWindow = openBlankPrintWindow();
    if (!printWindow) {
      toast.error(t('quality.printWindowBlocked') || 'Unable to open print window. Please allow popups.');
      return;
    }
    try {
      const preparedRecord = await prepareShippingReceivingPrintRecord(record);
      setPrintingRecordsList([preparedRecord]);
      setPrintRequest({ mode: 'single', printWindow });
    } catch (printError) {
      printWindow.close();
      console.error('Failed to prepare shipping document identifiers:', printError);
      toast.error('Unable to prepare document barcode.');
    }
  };

  useEffect(() => {
    if (!printRequest) return undefined;

    const timer = window.setTimeout(() => {
      const sheets = Array.from(printContainerRef.current?.querySelectorAll('.a4-print-sheet') || []);
      const opened = writePrintDocument({
        printWindow: printRequest.printWindow,
        title: 'EGAST Shipping Document',
        elements: sheets,
      });

      if (!opened) {
        printRequest.printWindow?.close?.();
        toast.error(t('quality.printWindowBlocked') || 'Unable to open print window. Please allow popups.');
      } else if (printRequest.mode === 'all') {
        toast.success(
          lang === 'ar'
            ? `تم تجهيز طباعة المستندات بنجاح (${printRequest.count})`
            : `Print ready (${printRequest.count} document(s))`
        );
      }

      setPrintRequest(null);
      setPrintingRecordsList([]);
    }, 100);

    return () => window.clearTimeout(timer);
  }, [printRequest, toast, t, lang]);

  return (
    <div className="page-shell quality-wizard purchase-quotation-review-page">
      <PageHeader
        eyebrow={t('shippingDelivery.title')}
        title={t('purchaseQuotation.reviewLogTitle')}
        description={t('purchaseQuotation.reviewLogDesc')}
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="app-button app-button--secondary app-button--compact"
              onClick={() => navigate('/shipping-delivery')}
            >
              {lang === 'ar' ? '→' : '←'} {t('shippingDelivery.title')}
            </button>
            <button
              type="button"
              className="app-button app-button--secondary app-button--compact"
              onClick={fetchRecords}
              disabled={loading}
            >
              {loading ? t('common.loading') : `🔄 ${t('common.refresh')}`}
            </button>
          </div>
        }
      />

      {/* Filter and Search Bar */}
      <section className="card-panel" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', maxWidth: '480px' }}>
            <input
              type="search"
              className="app-input"
              placeholder={t('purchaseQuotation.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={loading && records.length === 0}
            />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>
            {records.length} {t('purchaseQuotation.postedRecords')}
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      {loading && records.length === 0 ? (
        <section className="card-panel" style={{ textAlign: 'center', padding: '48px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
            <CircularProgress size={22} />
            <span>{t('common.loading')}</span>
          </div>
        </section>
      ) : error && records.length === 0 ? (
        <section className="card-panel" style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div className="feedback-message feedback-message--error" style={{ marginBottom: '16px' }}>
            {error}
          </div>
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={fetchRecords}
          >
            {t('common.retry')}
          </button>
        </section>
      ) : records.length === 0 ? (
        <section className="card-panel" style={{ padding: '48px 24px' }}>
          <EmptyState
            icon="✅"
            title={t('purchaseQuotation.noPostedRecords')}
            message={t('purchaseQuotation.noPostedRecordsDesc')}
          />
        </section>
      ) : (
        <section className="card-panel" style={{ padding: '0', overflowX: 'auto' }}>
          <table className="app-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-secondary)', textAlign: lang === 'ar' ? 'right' : 'left' }}>
                <th style={{ padding: '12px' }}>#</th>
                <th style={{ padding: '12px' }}>{t('purchaseQuotation.sapDocNum')}</th>
                <th style={{ padding: '12px' }}>{t('purchaseQuotation.vendor')}</th>
                <th style={{ padding: '12px' }}>{t('purchaseQuotation.postingDate')}</th>
                <th style={{ padding: '12px' }}>{t('purchaseQuotation.validUntil')}</th>
                <th style={{ padding: '12px' }}>{t('purchaseQuotation.totalPaymentDue')}</th>
                <th style={{ padding: '12px' }}>{t('purchaseQuotation.postedBy')}</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => (
                <tr key={rec.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px', fontWeight: 600 }}>#{rec.id}</td>
                  <td style={{ padding: '12px', fontWeight: 700, color: 'var(--color-primary)' }}>
                    {rec.sap_doc_num || rec.sap_doc_entry || '-'}
                  </td>
                  <td style={{ padding: '12px' }}>{rec.vendor_name || rec.vendor_card_code || '-'}</td>
                  <td style={{ padding: '12px' }}>{rec.posting_date || '-'}</td>
                  <td style={{ padding: '12px' }}>{rec.valid_until || '-'}</td>
                  <td style={{ padding: '12px', fontWeight: 600 }}>
                    {Number(rec.total_payment_due || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {rec.currency || 'EGP'}
                  </td>
                  <td style={{ padding: '12px' }}>{rec.posted_by || '-'}</td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <div className="app-action-icon-group">
                      <ViewActionButton
                        onClick={() => navigate(`/shipping-delivery/documents/${rec.id}`)}
                      />
                      <PrintActionButton
                        onClick={() => handlePrintSingle(rec)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Hidden printable sheets rendered for window.print() via writePrintDocument */}
      {printingRecordsList.length > 0 && (
        <div
          className="qrev-print-report"
          aria-hidden="true"
          style={{ display: 'none' }}
          ref={printContainerRef}
        >
          {printingRecordsList.map((doc, idx) => (
            <div
              key={doc.id}
              className="a4-print-sheet"
              style={{
                pageBreakAfter: idx < printingRecordsList.length - 1 ? 'always' : 'auto',
                position: 'relative',
                width: '100%',
                minHeight: '297mm',
                boxSizing: 'border-box',
                direction: 'rtl',
              }}
            >
              {/* Top Logo Section */}
              <div className="report-print-logo-row">
                <div className="report-header-brand">
                  <img
                    src={egastLogo}
                    alt="EGAST Group"
                    className="report-header-logo"
                  />
                  <div className="report-header-text">
                    <h2>الشركة المصرية للخدمات الزراعية (إيجاست)</h2>
                    <p>SHIPPING &amp; RECEIVING OPERATIONS</p>
                  </div>
                </div>
                <div className="report-doc-no">
                  <span className="report-badge">مستند شحن معتمد</span>
                  <PrintDocumentBarcode identification={doc._printIdentification} />
                </div>
              </div>

              {/* Main Title */}
              <div className="report-main-title">
                <h1>مستند شحن</h1>
                <span>SHIPPING DOCUMENT</span>
              </div>

              {/* Metadata Grid */}
              <div className="report-info-grid">
                <div className="info-cell">
                  <span className="cell-lbl">رقم المرجع الداخلي:</span>{' '}
                  <strong>#{doc.id}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">رقم المستند:</span>{' '}
                  <strong>{doc.sap_doc_num || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">رقم مرجع المستند:</span>{' '}
                  <strong>{doc.sap_doc_entry || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">حالة المستند:</span>{' '}
                  <strong style={{ color: '#16a34a' }}>تم الشحن والاعتماد</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">المورد:</span>{' '}
                  <strong>{doc.vendor_name || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">كود المورد:</span>{' '}
                  <strong>{doc.vendor_card_code || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">رقم السيارة / الشاحنة:</span>{' '}
                  <strong>{doc.vehicle_number || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">عدد الحاويات:</span>{' '}
                  <strong>{doc.container_quantity !== undefined && doc.container_quantity !== null && doc.container_quantity !== '' ? doc.container_quantity : '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">تاريخ الشحن:</span>{' '}
                  <strong>{doc.posting_date || (doc.posted_at ? doc.posted_at.slice(0, 10) : '-')}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">صالح حتى:</span>{' '}
                  <strong>{doc.valid_until || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">تاريخ المستند:</span>{' '}
                  <strong>{doc.document_date || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">التاريخ المطلوب:</span>{' '}
                  <strong>{doc.required_date || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">اعتمد بواسطة:</span>{' '}
                  <strong>{doc.posted_by || doc.created_by || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">تاريخ ووقت الاعتماد:</span>{' '}
                  <strong>{doc.posted_at ? new Date(doc.posted_at).toLocaleString('ar-EG') : '-'}</strong>
                </div>
                {doc.vendor_ref_no && doc.vendor_ref_no !== '-' && (
                  <div className="info-cell">
                    <span className="cell-lbl">مرجع المورد:</span>{' '}
                    <strong>{doc.vendor_ref_no}</strong>
                  </div>
                )}
                <ShippingPrintRemark value={doc.journal_remark} />
                <ShippingPrintRemark value={doc.remarks} label="الملاحظات:" wide />
              </div>

              {/* Line Items Table */}
              <h4 className="report-section-header" style={{ marginTop: '24px' }}>
                بيانات بنود الشحن (Shipping Items)
              </h4>
              <table
                className="excel-matrix-table"
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  marginBottom: '16px',
                  fontSize: '12px',
                }}
              >
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center', width: '35px' }}>#</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'start' }}>كود الصنف</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'start' }}>الوصف / البيان</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>المجموعة</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'end' }}>الكمية</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>الوحدة</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'end' }}>سعر الوحدة</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'end' }}>الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(doc.lines) && doc.lines.length > 0 ? (
                    doc.lines.map((line, lIdx) => (
                      <tr key={lIdx}>
                        <td style={{ border: '1px solid #cbd5e1', padding: '7px 8px', textAlign: 'center' }}>{lIdx + 1}</td>
                        <td style={{ border: '1px solid #cbd5e1', padding: '7px 8px', textAlign: 'start', fontFamily: 'monospace' }}>
                          {line.item_code || '-'}
                        </td>
                        <td style={{ border: '1px solid #cbd5e1', padding: '7px 8px', textAlign: 'start', fontWeight: 600 }}>
                          {line.item_description || line.item_name || '-'}
                        </td>
                        <td style={{ border: '1px solid #cbd5e1', padding: '7px 8px', textAlign: 'center' }}>
                          {line.item_group_name || line.item_group_code || '-'}
                        </td>
                        <td style={{ border: '1px solid #cbd5e1', padding: '7px 8px', textAlign: 'end', fontWeight: 700 }}>
                          {Number(line.quoted_qty || line.quantity || 0).toLocaleString()}
                        </td>
                        <td style={{ border: '1px solid #cbd5e1', padding: '7px 8px', textAlign: 'center' }}>
                          {line.uom_code || line.uom_name || 'PCS'}
                        </td>
                        <td style={{ border: '1px solid #cbd5e1', padding: '7px 8px', textAlign: 'end' }}>
                          {Number(line.unit_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ border: '1px solid #cbd5e1', padding: '7px 8px', textAlign: 'end', fontWeight: 700 }}>
                          {Number(line.line_total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} style={{ border: '1px solid #cbd5e1', padding: '12px', textAlign: 'center', color: '#64748b' }}>
                        لا توجد بنود مسجلة
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Financial Totals */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
                <table
                  style={{
                    width: '320px',
                    borderCollapse: 'collapse',
                    fontSize: '12px',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        المجموع قبل الخصم (Subtotal):
                      </td>
                      <td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0', textAlign: 'end', fontWeight: 600 }}>
                        {Number(doc.total_before_discount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {doc.currency || 'EGP'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        الخصم ({Number(doc.discount_percent || 0).toFixed(2)}%):
                      </td>
                      <td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0', textAlign: 'end', fontWeight: 600, color: '#dc2626' }}>
                        -{Number(doc.discount_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {doc.currency || 'EGP'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        ضريبة القيمة المضافة (Tax):
                      </td>
                      <td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0', textAlign: 'end', fontWeight: 600 }}>
                        +{Number(doc.tax_total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {doc.currency || 'EGP'}
                      </td>
                    </tr>
                    <tr style={{ background: '#f8fafc', fontWeight: 700, fontSize: '13px' }}>
                      <td style={{ padding: '8px 12px', borderTop: '2px solid #0f172a' }}>
                        إجمالي المستحق (Total Due):
                      </td>
                      <td style={{ padding: '8px 12px', borderTop: '2px solid #0f172a', textAlign: 'end', color: '#1e3a8a' }}>
                        {Number(doc.total_payment_due || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {doc.currency || 'EGP'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Signatures */}
              <div className="report-signature-row" style={{ marginTop: '36px' }}>
                <div className="sig-column">
                  <p>مسؤول الشحن والمشتريات</p>
                  <div className="sig-line" />
                  <span className="sig-date-placeholder">التوقيع والتاريخ</span>
                </div>
                <div className="sig-column">
                  <p>السائق / مندوب المورد</p>
                  <div className="sig-line" />
                  <span className="sig-date-placeholder">التوقيع والتاريخ</span>
                </div>
                <div className="sig-column">
                  <p>اعتماد إدارة المشتريات</p>
                  <div className="sig-line" />
                  <span className="sig-date-placeholder">الاعتماد والتاريخ</span>
                </div>
              </div>

              {/* Document Footer */}
              <div className="report-print-footer">
                <span className="report-print-footer-brand">
                  الشركة المصرية للخدمات الزراعية (إيجاست) · قسم الشحن والاستلام
                </span>
                <span className="report-print-footer-meta">
                  SHIPPING DOCUMENT · Page 1 of 1
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PurchaseQuotationReviewPage;
