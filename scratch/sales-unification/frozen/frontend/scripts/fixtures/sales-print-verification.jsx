// Real print component/helper, served by Vite without assuming optimizer paths.
import React from 'react';
import { createRoot } from 'react-dom/client';
import Printable from '../../src/components/print/SalesDocumentPrintable';
import { translations } from '../../src/i18n/translations';
import { openBlankPrintWindow, writePrintDocument } from '../../src/utils/printDocument';
import '../../src/styles/pages/customization-delivery.css';
import '../../src/styles/print-design-system.css';

export function install() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  window.renderFixture = async (type, lang, count) => {
    const t = key => key.split('.').reduce((v, k) => v?.[k], translations[lang]) || key;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    const lines = Array.from({ length: count }, (_, i) => ({
      item_code: `ROW-${String(i + 1).padStart(3, '0')}`,
      item_description: lang === 'ar'
        ? 'صنف تجريبي بوصف طويل للتأكد من التفاف النص بصورة صحيحة'
        : 'Distinctive long item description checking wrapping and complete printable content',
      quantity: 250 / count, unit_price: 24, line_total: 6000 / count,
      uom: 'KG', warehouse_code: 'WH-VERIFIED',
    }));
    root.render(<Printable t={t} generatedAt="2026-10-04 12:00" document={{
      documentType: type, docNum: 5001, docEntry: 1001, customerCode: 'C001',
      customerName: lang === 'ar'
        ? 'شركة العميل التجريبي ذات الاسم الطويل لاختبار الطباعة باللغة العربية'
        : 'A very long distinctive customer company name for production printing verification',
      docDate: '2026-10-04', dueDate: '2026-10-15', currency: 'USD',
      lines, totalAmount: 6000, totalQuantity: 250,
    }} />);
    await new Promise(resolve => setTimeout(resolve, 150));
  };
  window.printFixture = ({ lang, orientation }) => {
    const printWindow = openBlankPrintWindow();
    writePrintDocument({ printWindow, title: 'Sales print readiness', elements: host.firstElementChild,
      orientation, direction: lang === 'ar' ? 'rtl' : 'ltr' });
  };
}
