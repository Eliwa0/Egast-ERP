import React from 'react';

export default function ExcelSummaryMatrix({ totals = {}, sumAH = 0, sumAF = 0, sumAG = 0, t }) {
  const translate = (key, fallback) => {
    if (!t) return fallback;
    const val = t(key);
    return val === key ? fallback : val;
  };

  const pctAD = sumAH > 0 ? ((totals['grade_1'] || 0) / sumAH) * 100 : 0;
  const pctAE = sumAH > 0 ? ((totals['grade_2'] || 0) / sumAH) * 100 : 0;
  const pctAF = sumAH > 0 ? (sumAF / sumAH) * 100 : 0;
  const pctAG = sumAH > 0 ? (sumAG / sumAH) * 100 : 0;
  
  const bruisesQty = totals['bruises'] || 0;
  const cutsQty = totals['cuts'] || 0;
  const combinedBruisesQty = bruisesQty + cutsQty;
  const pctBruisesCuts = sumAH > 0 ? (combinedBruisesQty / sumAH) * 100 : 0;
  
  const highCutQty = totals['high_cut'] || 0;
  const pctHighCut = sumAH > 0 ? (highCutQty / sumAH) * 100 : 0;

  const leftGroup = [
    { key: 'oil_spots', name: translate('quality.defects.oil_spots', 'بقع زيتية (Oil Spots)') },
    { key: 'under_size', name: translate('quality.defects.under_size', 'اندر (Under Size)') },
    { key: 'tearing', name: translate('quality.defects.tearing', 'تنتيش (Tearing)') },
    { key: 'combined_bruises_cuts', name: translate('quality.defects.bruises', 'جروح وكدمات (Cuts & Bruises)') },
    { key: 'creasing', name: translate('quality.defects.creasing', 'تبحير (Creasing)') },
    { key: 'fall_drop', name: translate('quality.defects.fall_drop', 'سقط (Drop)') },
    { key: 'navel_blight', name: translate('quality.defects.navel_blight', 'فتق سرة (Navel Blight)') },
    { key: 'softness', name: translate('quality.defects.softness', 'ليونه (Softness)') },
    { key: 'molds', name: translate('quality.defects.molds', 'اعفان (Molds)') },
  ];

  const rightGroup = [
    { key: 'acarus', name: translate('quality.defects.acarus', 'اكاروس (Acarus)') },
    { key: 'scale_insect', name: translate('quality.defects.scale_insect', 'حشرة قشرية (Scale Insect)') },
    { key: 'spray_marks', name: translate('quality.defects.spray_marks', 'أثار رش (Spray Marks)') },
    { key: 'citrus_rust', name: translate('quality.defects.citrus_rust', 'صدأ موالح (Citrus Rust)') },
    { key: 'vegetable_defects', name: translate('quality.defects.vegetable_defects', 'خضار (Greening)') },
    { key: 'sunburn', name: translate('quality.defects.sunburn', 'لسعة الشمس (Sunburn)') },
    { key: 'mealybug', name: translate('quality.defects.mealybug', 'بق دقيقى (Mealybug)') },
    { key: 'sooty_mold', name: translate('quality.defects.sooty_mold', 'فطر هبابي (Sooty Mold)') },
    { key: 'mutations', name: translate('quality.defects.mutations', 'طفرات (Mutations)') },
  ];

  const leftFiltered = leftGroup.map(item => {
    let qty = 0;
    let pct = 0;
    if (item.key === 'combined_bruises_cuts') {
      qty = combinedBruisesQty;
      pct = pctBruisesCuts;
    } else {
      qty = totals[item.key] || 0;
      pct = sumAH > 0 ? (qty / sumAH) * 100 : 0;
    }
    return { ...item, qty, pct };
  }).filter(item => item.qty > 0);

  const rightFiltered = rightGroup.map(item => {
    const qty = totals[item.key] || 0;
    const pct = sumAH > 0 ? (qty / sumAH) * 100 : 0;
    return { ...item, qty, pct };
  }).filter(item => item.qty > 0);

  return (
    <table className="excel-matrix-table" style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #475569', direction: 'rtl' }}>
      <thead>
        <tr style={{ backgroundColor: '#1e3a8a', color: 'white', fontWeight: 700 }}>
          <th colSpan="6" style={{ textAlign: 'right', padding: '10px 14px', fontSize: '15px' }}>المؤشرات الأساسية والتصنيف (Classification & KPIs)</th>
        </tr>
      </thead>
      <tbody>
        <tr style={{ backgroundColor: '#fff9db', fontWeight: 700, color: '#854d0e', borderBottom: '1.5px solid #cbd5e1' }}>
          <td colSpan="3" style={{ textAlign: 'right', padding: '10px 14px', borderLeft: '1px solid #cbd5e1' }}>
            متوسط نسبة الجروح و الكدمات: <span style={{ fontSize: '15px', fontWeight: 800, color: '#dc2626' }}>{pctBruisesCuts.toFixed(2)}%</span> ({combinedBruisesQty} وحدة)
          </td>
          <td colSpan="3" style={{ textAlign: 'right', padding: '10px 14px' }}>
            متوسط نسبة القص العالى تصل إلى: <span style={{ fontSize: '15px', fontWeight: 800, color: '#1e3a8a' }}>{pctHighCut.toFixed(2)}%</span> ({highCutQty} وحدة)
          </td>
        </tr>

        <tr className="excel-section-header" style={{ backgroundColor: '#f1f5f9', fontWeight: 700, borderBottom: '1.5px solid #cbd5e1', textAlign: 'center' }}>
          <td style={{ padding: '10px 14px' }}>درجة أولى (Q 1)</td>
          <td style={{ padding: '10px 14px' }}>درجة ثانية (Q 2)</td>
          <td style={{ padding: '10px 14px' }}>بنزات (Binz)</td>
          <td style={{ padding: '10px 14px' }}>فرزة خارجية + Waste</td>
          <td colSpan="2" style={{ padding: '10px 14px' }}>الإجمالي (Total)</td>
        </tr>

        <tr style={{ textAlign: 'center', fontWeight: 800, borderBottom: '2px solid #cbd5e1', fontSize: '14.5px' }}>
          <td style={{ color: '#16a34a', padding: '10px 14px' }}>{pctAD.toFixed(2)}%<br/><span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>({totals['grade_1'] || 0} وحدة)</span></td>
          <td style={{ color: '#1e3a8a', padding: '10px 14px' }}>{pctAE.toFixed(2)}%<br/><span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>({totals['grade_2'] || 0} وحدة)</span></td>
          <td style={{ color: '#d97706', padding: '10px 14px' }}>{pctAF.toFixed(2)}%<br/><span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>({sumAF} وحدة)</span></td>
          <td style={{ color: '#dc2626', padding: '10px 14px' }}>{pctAG.toFixed(2)}%<br/><span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>({sumAG} وحدة)</span></td>
          <td colSpan="2" style={{ backgroundColor: '#f8fafc', fontSize: '16px', padding: '10px 14px' }}>{sumAH > 0 ? '100.00%' : '0.00%'}<br/><span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>({sumAH} وحدة)</span></td>
        </tr>

        <tr style={{ backgroundColor: '#1e3a8a', color: 'white', fontWeight: 700 }}>
          <th colSpan="6" style={{ textAlign: 'right', padding: '10px 14px', fontSize: '15px' }}>جدول تحليل ونسب العيوب بالتفصيل (Defect Details Grid)</th>
        </tr>

        {/* SECTION 1: External & Physiological Defects */}
        <tr style={{ backgroundColor: '#e2e8f0', fontWeight: 700, borderBottom: '1.5px solid #cbd5e1', fontSize: '13px' }}>
          <td colSpan="6" style={{ textAlign: 'right', padding: '8px 12px', color: '#1e3a8a' }}>
            📁 {translate('quality.leftSideDefects', 'العيوب الخارجية والفسيولوجية (External & Physiological Defects)')}
          </td>
        </tr>
        {leftFiltered.length > 0 && (
          <tr style={{ backgroundColor: '#f8fafc', fontWeight: 600, borderBottom: '1px solid #e2e8f0', fontSize: '12px', textAlign: 'center' }}>
            <td colSpan="4" style={{ textAlign: 'right', padding: '6px 10px' }}>اسم العيب</td>
            <td style={{ width: '15%' }}>الكمية</td>
            <td style={{ width: '15%' }}>النسبة</td>
          </tr>
        )}
        {leftFiltered.length > 0 ? (
          leftFiltered.map((item, idx) => (
            <tr key={`left-${idx}`} className="excel-row" style={{ borderBottom: '1px solid #cbd5e1', fontSize: '13px', verticalAlign: 'middle' }}>
              <td colSpan="4" style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600 }}>{item.name}</td>
              <td style={{ textAlign: 'center', fontWeight: 700 }}>{item.qty}</td>
              <td style={{ textAlign: 'center', fontWeight: 700, color: '#dc2626' }}>{item.pct.toFixed(2)}%</td>
            </tr>
          ))
        ) : (
          <tr style={{ borderBottom: '1px solid #cbd5e1', fontSize: '13px', fontStyle: 'italic' }}>
            <td colSpan="6" style={{ textAlign: 'center', padding: '12px', color: '#64748b' }}>
              ℹ️ {translate('quality.noDefectsInCat', 'No defects were found in this category.')}
            </td>
          </tr>
        )}

        {/* SECTION 2: Agricultural Pests & Skin Defects */}
        <tr style={{ backgroundColor: '#e2e8f0', fontWeight: 700, borderBottom: '1.5px solid #cbd5e1', fontSize: '13px' }}>
          <td colSpan="6" style={{ textAlign: 'right', padding: '8px 12px', color: '#1e3a8a' }}>
            📁 {translate('quality.rightSideDefects', 'الآفات الزراعية وعيوب القشرة (Agricultural Pests & Skin Defects)')}
          </td>
        </tr>
        {rightFiltered.length > 0 && (
          <tr style={{ backgroundColor: '#f8fafc', fontWeight: 600, borderBottom: '1px solid #e2e8f0', fontSize: '12px', textAlign: 'center' }}>
            <td colSpan="4" style={{ textAlign: 'right', padding: '6px 10px' }}>اسم العيب</td>
            <td style={{ width: '15%' }}>الكمية</td>
            <td style={{ width: '15%' }}>النسبة</td>
          </tr>
        )}
        {rightFiltered.length > 0 ? (
          rightFiltered.map((item, idx) => (
            <tr key={`right-${idx}`} className="excel-row" style={{ borderBottom: '1px solid #cbd5e1', fontSize: '13px', verticalAlign: 'middle' }}>
              <td colSpan="4" style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600 }}>{item.name}</td>
              <td style={{ textAlign: 'center', fontWeight: 700 }}>{item.qty}</td>
              <td style={{ textAlign: 'center', fontWeight: 700, color: '#dc2626' }}>{item.pct.toFixed(2)}%</td>
            </tr>
          ))
        ) : (
          <tr style={{ borderBottom: '1px solid #cbd5e1', fontSize: '13px', fontStyle: 'italic' }}>
            <td colSpan="6" style={{ textAlign: 'center', padding: '12px', color: '#64748b' }}>
              ℹ️ {translate('quality.noDefectsInCat', 'No defects were found in this category.')}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
