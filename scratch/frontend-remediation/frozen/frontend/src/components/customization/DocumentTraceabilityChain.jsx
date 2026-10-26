import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Package, Truck, ArrowRight, ArrowLeft } from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';

export default function DocumentTraceabilityChain({
  quotationNum,
  orderNum,
  deliveryNums = [],
  currentDoc = 'quotation', // 'quotation' | 'order' | 'delivery'
  variant = 'full', // 'full' | 'inline'
}) {
  const navigate = useNavigate();
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const ArrowIcon = isAr ? ArrowLeft : ArrowRight;

  const deliveries = Array.isArray(deliveryNums)
    ? deliveryNums.filter(Boolean)
    : deliveryNums ? [deliveryNums] : [];

  const handleQuotationClick = (e) => {
    e.stopPropagation();
    if (currentDoc !== 'quotation' && quotationNum) {
      navigate(`/customization-delivery/quotations/review?quotation=${quotationNum}`);
    }
  };

  const handleOrderClick = (e) => {
    e.stopPropagation();
    if (currentDoc !== 'order' && orderNum) {
      navigate(`/customization-delivery/review?order=${orderNum}`);
    }
  };

  const handleDeliveryClick = (e, delNum) => {
    e.stopPropagation();
    if (currentDoc !== 'delivery' && delNum) {
      navigate(`/customization-delivery/review/deliveries?delivery=${delNum}`);
    }
  };

  if (variant === 'inline') {
    return (
      <div
        className="doc-trace-inline"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '3px',
          fontSize: '0.72rem',
          flexWrap: 'wrap',
        }}
      >
        {/* Step 1: Quotation */}
        <span
          className={`doc-trace-chip ${currentDoc === 'quotation' ? 'doc-trace-chip--active' : ''} ${quotationNum && currentDoc !== 'quotation' ? 'doc-trace-chip--clickable' : ''}`}
          onClick={quotationNum && currentDoc !== 'quotation' ? handleQuotationClick : undefined}
          title={quotationNum ? (isAr ? 'انتقل إلى مراجعة عرض السعر' : 'Go to Quotation Review') : undefined}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            padding: '1px 5px',
            borderRadius: '4px',
            background: currentDoc === 'quotation' ? 'var(--primary-subtle, rgba(37, 99, 235, 0.12))' : 'var(--bg-muted, rgba(127,127,127,0.1))',
            color: currentDoc === 'quotation' ? 'var(--color-primary, #2563eb)' : 'var(--text-muted)',
            fontWeight: currentDoc === 'quotation' ? 700 : 500,
            cursor: quotationNum && currentDoc !== 'quotation' ? 'pointer' : 'default',
            border: currentDoc === 'quotation' ? '1px solid var(--color-primary, #2563eb)' : '1px solid transparent',
            whiteSpace: 'nowrap',
          }}
        >
          <FileText size={11} />
          <span>{quotationNum ? `#${quotationNum}` : (isAr ? 'عرض سعر' : 'Quotation')}</span>
        </span>

        <ArrowIcon size={10} color="var(--text-muted)" />

        {/* Step 2: Order */}
        <span
          className={`doc-trace-chip ${currentDoc === 'order' ? 'doc-trace-chip--active' : ''} ${orderNum && currentDoc !== 'order' ? 'doc-trace-chip--clickable' : ''}`}
          onClick={orderNum && currentDoc !== 'order' ? handleOrderClick : undefined}
          title={orderNum ? (isAr ? 'انتقل إلى مراجعة أمر البيع' : 'Go to Sales Order Review') : undefined}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            padding: '1px 5px',
            borderRadius: '4px',
            background: currentDoc === 'order' ? 'var(--primary-subtle, rgba(37, 99, 235, 0.12))' : 'var(--bg-muted, rgba(127,127,127,0.1))',
            color: currentDoc === 'order' ? 'var(--color-primary, #2563eb)' : orderNum ? 'var(--text)' : 'var(--text-muted)',
            fontWeight: currentDoc === 'order' ? 700 : 500,
            cursor: orderNum && currentDoc !== 'order' ? 'pointer' : 'default',
            border: currentDoc === 'order' ? '1px solid var(--color-primary, #2563eb)' : '1px solid transparent',
            whiteSpace: 'nowrap',
          }}
        >
          <Package size={11} />
          <span>{orderNum ? `#${orderNum}` : (isAr ? 'أمر بيع' : 'Order')}</span>
        </span>

        <ArrowIcon size={10} color="var(--text-muted)" />

        {/* Step 3: Delivery */}
        {deliveries.length > 0 ? (
          deliveries.map((delNum) => (
            <span
              key={delNum}
              className={`doc-trace-chip ${currentDoc === 'delivery' ? 'doc-trace-chip--active' : ''} ${currentDoc !== 'delivery' ? 'doc-trace-chip--clickable' : ''}`}
              onClick={currentDoc !== 'delivery' ? (e) => handleDeliveryClick(e, delNum) : undefined}
              title={isAr ? 'انتقل إلى مراجعة التسليم' : 'Go to Delivery Review'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                padding: '1px 5px',
                borderRadius: '4px',
                background: currentDoc === 'delivery' ? 'var(--primary-subtle, rgba(37, 99, 235, 0.12))' : 'var(--bg-muted, rgba(127,127,127,0.1))',
                color: currentDoc === 'delivery' ? 'var(--color-primary, #2563eb)' : 'var(--text)',
                fontWeight: currentDoc === 'delivery' ? 700 : 500,
                cursor: currentDoc !== 'delivery' ? 'pointer' : 'default',
                border: currentDoc === 'delivery' ? '1px solid var(--color-primary, #2563eb)' : '1px solid transparent',
                whiteSpace: 'nowrap',
              }}
            >
              <Truck size={11} />
              <span>#{delNum}</span>
            </span>
          ))
        ) : (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              padding: '1px 5px',
              borderRadius: '4px',
              background: 'var(--bg-muted, rgba(127,127,127,0.06))',
              color: 'var(--text-muted)',
              fontSize: '0.72rem',
              whiteSpace: 'nowrap',
            }}
          >
            <Truck size={11} />
            <span>{isAr ? 'لم يُسلّم بعد' : 'Not delivered'}</span>
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="doc-trace-full"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '14px 18px',
        background: 'var(--bg-soft, rgba(255, 255, 255, 0.03))',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        marginBottom: '16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
        <span>{isAr ? 'سلسلة تتبع المستند:' : 'Document Traceability:'}</span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        {/* Node 1: Quotation */}
        <div
          className={`trace-node ${currentDoc === 'quotation' ? 'trace-node--active' : ''}`}
          onClick={quotationNum && currentDoc !== 'quotation' ? handleQuotationClick : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderRadius: '8px',
            background: currentDoc === 'quotation' ? 'var(--primary-subtle, rgba(37, 99, 235, 0.12))' : 'var(--bg-elevated)',
            border: currentDoc === 'quotation' ? '1.5px solid var(--color-primary, #2563eb)' : '1px solid var(--border)',
            cursor: quotationNum && currentDoc !== 'quotation' ? 'pointer' : 'default',
            transition: 'all 0.15s ease',
          }}
          title={quotationNum && currentDoc !== 'quotation' ? (isAr ? 'فتح في مراجعة عروض الأسعار' : 'Open in Quotations Review') : undefined}
        >
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: currentDoc === 'quotation' ? 'var(--color-primary, #2563eb)' : 'var(--bg-muted)',
              color: currentDoc === 'quotation' ? '#ffffff' : 'var(--text-muted)',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}
          >
            1
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              {isAr ? 'عرض السعر' : 'Quotation'}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: currentDoc === 'quotation' ? 'var(--color-primary)' : 'var(--text)' }}>
              {quotationNum ? `#${quotationNum}` : (isAr ? 'غير مسجل' : 'N/A')}
            </div>
          </div>
        </div>

        <ArrowIcon size={16} color="var(--text-muted)" />

        {/* Node 2: Sales Order */}
        <div
          className={`trace-node ${currentDoc === 'order' ? 'trace-node--active' : ''}`}
          onClick={orderNum && currentDoc !== 'order' ? handleOrderClick : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderRadius: '8px',
            background: currentDoc === 'order' ? 'var(--primary-subtle, rgba(37, 99, 235, 0.12))' : 'var(--bg-elevated)',
            border: currentDoc === 'order' ? '1.5px solid var(--color-primary, #2563eb)' : '1px solid var(--border)',
            cursor: orderNum && currentDoc !== 'order' ? 'pointer' : 'default',
            transition: 'all 0.15s ease',
          }}
          title={orderNum && currentDoc !== 'order' ? (isAr ? 'فتح في مراجعة أوامر البيع' : 'Open in Sales Orders Review') : undefined}
        >
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: currentDoc === 'order' ? 'var(--color-primary, #2563eb)' : orderNum ? 'var(--accent-success, #22c55e)' : 'var(--bg-muted)',
              color: currentDoc === 'order' || orderNum ? '#ffffff' : 'var(--text-muted)',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}
          >
            2
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              {isAr ? 'أمر البيع' : 'Sales Order'}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: currentDoc === 'order' ? 'var(--color-primary)' : orderNum ? 'var(--text)' : 'var(--text-muted)' }}>
              {orderNum ? `#${orderNum}` : (isAr ? 'قيد الإجراء' : 'Pending')}
            </div>
          </div>
        </div>

        <ArrowIcon size={16} color="var(--text-muted)" />

        {/* Node 3: Delivery */}
        <div
          className={`trace-node ${currentDoc === 'delivery' ? 'trace-node--active' : ''}`}
          onClick={deliveries.length === 1 && currentDoc !== 'delivery' ? (e) => handleDeliveryClick(e, deliveries[0]) : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderRadius: '8px',
            background: currentDoc === 'delivery' ? 'var(--primary-subtle, rgba(37, 99, 235, 0.12))' : 'var(--bg-elevated)',
            border: currentDoc === 'delivery' ? '1.5px solid var(--color-primary, #2563eb)' : '1px solid var(--border)',
            cursor: deliveries.length === 1 && currentDoc !== 'delivery' ? 'pointer' : 'default',
            transition: 'all 0.15s ease',
          }}
          title={deliveries.length === 1 && currentDoc !== 'delivery' ? (isAr ? 'فتح في مراجعة التسليم' : 'Open in Delivery Review') : undefined}
        >
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: currentDoc === 'delivery' ? 'var(--color-primary, #2563eb)' : deliveries.length > 0 ? 'var(--accent-success, #22c55e)' : 'var(--bg-muted)',
              color: currentDoc === 'delivery' || deliveries.length > 0 ? '#ffffff' : 'var(--text-muted)',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}
          >
            3
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              {isAr ? 'التسليم' : 'Delivery'}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: currentDoc === 'delivery' ? 'var(--color-primary)' : deliveries.length > 0 ? 'var(--text)' : 'var(--text-muted)' }}>
              {deliveries.length > 0 ? (
                deliveries.map((del, idx) => (
                  <span
                    key={del}
                    onClick={currentDoc !== 'delivery' ? (e) => handleDeliveryClick(e, del) : undefined}
                    style={{
                      cursor: currentDoc !== 'delivery' ? 'pointer' : 'default',
                      textDecoration: currentDoc !== 'delivery' ? 'underline' : 'none',
                      marginInlineEnd: idx < deliveries.length - 1 ? '6px' : '0',
                    }}
                  >
                    #{del}
                  </span>
                ))
              ) : (
                isAr ? 'لم يُسلّم بعد' : 'Not Delivered'
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
