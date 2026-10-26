export const AF_KEYS = [
  'acarus', 'scale_insect', 'spray_marks', 'citrus_rust', 'thrips',
  'vegetable_defects', 'gummosis', 'sunburn', 'sooty_mold', 'mealybug', 'mutations'
];

export const AG_KEYS = [
  'oil_spots', 'under_size', 'tearing', 'bruises', 'cuts', 'venting',
  'fruit_fly', 'creasing', 'fall_drop', 'navel_blight', 'softness', 'molds'
];

export const calculateQualityMetrics = (samples, sampleCount) => {
  const totals = {
    acarus: 0, scale_insect: 0, spray_marks: 0, citrus_rust: 0, thrips: 0,
    vegetable_defects: 0, gummosis: 0, oil_spots: 0, sunburn: 0, sooty_mold: 0,
    mealybug: 0, tearing: 0, high_cut: 0, bruises: 0, cuts: 0, under_size: 0,
    venting: 0, fruit_fly: 0, creasing: 0, fall_drop: 0, mutations: 0,
    navel_blight: 0, softness: 0, molds: 0, grade_1: 0, grade_2: 0
  };

  samples.forEach((s) => {
    Object.keys(totals).forEach((k) => {
      totals[k] += Number(s.defects?.[k] || 0);
    });
  });

  const sumAF = AF_KEYS.reduce((acc, k) => acc + (totals[k] || 0), 0);
  const sumAG = AG_KEYS.reduce((acc, k) => acc + (totals[k] || 0), 0);
  const sumAH = sumAF + sumAG + (totals['grade_1'] || 0) + (totals['grade_2'] || 0);

  const avgDefects = sampleCount > 0 ? (sumAH / sampleCount).toFixed(2) : '0.00';

  const combinedBruisesCuts = (totals['bruises'] || 0) + (totals['cuts'] || 0);
  const pctBruisesCuts = sumAH > 0 ? ((combinedBruisesCuts / sumAH) * 100).toFixed(2) : '0.00';
  const pctHighCut = sumAH > 0 ? (((totals['high_cut'] || 0) / sumAH) * 100).toFixed(2) : '0.00';

  const quarantineViolation = (totals['molds'] || 0) > 0;
  const avgDefectsFloat = parseFloat(avgDefects);

  let decision = 'Accepted';
  if (quarantineViolation) {
    decision = 'Rejected (Quarantine Defects)';
  } else if (avgDefectsFloat > 4.0) {
    decision = 'Rejected (Tolerable Boundary Exceeded)';
  } else if (sumAH > 0) {
    decision = 'Conditionally Accepted';
  }

  return {
    totals,
    sumAF,
    sumAG,
    sumAH,
    avgDefects,
    pctBruisesCuts,
    pctHighCut,
    quarantineViolation,
    decision
  };
};
